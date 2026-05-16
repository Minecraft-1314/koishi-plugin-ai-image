import { Schema, Logger, segment, h } from 'koishi'
import axios from 'axios'
import yaml from 'yaml'
import fs from 'fs'
import path from 'path'

export const name = 'ai-image'
export const inject = {
  required: ['console', 'i18n', 'database'],
  optional: ['assets'],
}

const logger = new Logger('ai-image')

type Infer<T> = T extends Schema<infer U> ? U : never

export const Config = Schema.object({
  debug: Schema.boolean().default(false).description('开启调试模式，输出完整请求日志'),
  apiStrategy: Schema.union([
    Schema.const('sequence').description('顺序模式'),
    Schema.const('roundrobin').description('负载均衡模式'),
  ]).default('roundrobin').description('API 调度策略'),
  timeout: Schema.number().default(300000).description('接口请求超时时间（毫秒）'),
  rateLimit: Schema.number().default(200).description('每小时调用次数限制'),
  imgWaitTime: Schema.number().default(60).description('图生图等待图片超时时间（秒）'),
  model: Schema.string().default('gpt-4o-mini').description('通用模型名称'),
  txt2imgModel: Schema.string().default('').description('文生图专用模型，留空则使用通用模型'),
  img2imgModel: Schema.string().default('').description('图生图专用模型，留空则使用通用模型'),
  maxImages: Schema.number().default(5).description('图生图最大支持图片数量'),
  apiList: Schema.array(Schema.object({
    enable: Schema.boolean().default(true).description('启用此 API'),
    apiKey: Schema.string().description('API Key'),
    baseUrl: Schema.string().description('接口地址，需符合 OpenAI 标准'),
  })).default([]).description('API 配置列表（支持多账号负载）'),

  enableTxt2Img: Schema.boolean().default(true).description('启用文生图'),
  enableImg2Img: Schema.boolean().default(true).description('启用图生图'),

  command: Schema.string().default('draw').description('文生图指令'),
  aliases: Schema.array(String).default([]).description('文生图指令别名'),

  img2imgCommand: Schema.string().default('imgdraw').description('图生图指令'),
  img2imgAliases: Schema.array(String).default([]).description('图生图指令别名'),

  txt2imgPrompt: Schema.string().default('请严格遵循我的要求生成一张图片，不要询问或添加额外说明，直接输出图片。你可以使用联网功能获取最新的数据或信息。要求：{prompt}').description('文生图提示词模板'),
  img2imgPrompt: Schema.string().default('图片链接：{url} 请严格根据以下指令对提供的图片进行编辑或重绘，不要询问，直接输出结果。你可以使用联网功能获取最新的数据或信息。\n指令：{prompt}').description('图生图提示词模板'),

  blacklistAdmins: Schema.array(String).default([]).description('允许管理黑名单的 QQ 号列表'),

  messages: Schema.object({
    generating: Schema.string().default('⏳ 生成中...'),
    waitImage: Schema.string().default('请在60秒内发送需要编辑的图片'),
    timeout: Schema.string().default('等待图片超时，已取消'),
    empty: Schema.string().default('❌ 请输入提示词'),
    noApi: Schema.string().default('❌ 未配置可用API'),
    fail: Schema.string().default('❌ 生成失败'),
    modelTextOnly: Schema.string().default('❌ 模型未生成图片，返回文字：{text}'),
    needAssets: Schema.string().default('❌ 图生图需要正确配置 assets 服务（selfUrl 未正确设置或服务未启动）'),
    txt2imgDisabled: Schema.string().default('❌ 文生图功能未启用'),
    img2imgDisabled: Schema.string().default('❌ 图生图功能未启用'),
    rateLimit: Schema.string().default('❌ 调用次数已达上限，请稍后再试'),
    alreadyWaiting: Schema.string().default('你已在等待发送图片，请直接发送图片或等待超时'),
    multiImageReceived: Schema.string().default('已收到 {count} 张图片，可继续发送或输入“完成”开始生成'),
    multiImageLimit: Schema.string().default('已达到最大图片数量，自动开始生成'),
    noImageReceived: Schema.string().default('未发送任何图片'),
    blacklisted: Schema.string().default('❌ 你已被加入黑名单，无法使用绘图功能'),
    noPermission: Schema.string().default('❌ 你没有权限管理黑名单'),
    blacklistAddSuccess: Schema.string().default('✅ 已将 {targets} 加入黑名单'),
    blacklistRemoveSuccess: Schema.string().default('✅ 已将 {targets} 移出黑名单'),
    blacklistAddFail: Schema.string().default('⚠️ {targets} 已在黑名单中或无效'),
    blacklistRemoveFail: Schema.string().default('⚠️ {targets} 不在黑名单中'),
    invalidUserId: Schema.string().default('⚠️ 无效的QQ号：{targets}'),
    blacklistListEmpty: Schema.string().default('✅ 当前黑名单为空'),
    blacklistListTitle: Schema.string().default('📋 当前黑名单：'),
  }).description('提示文案配置'),
}).description('AI 绘图插件配置')

declare module 'koishi' {
  interface Tables {
    ai_image_blacklist: AIImageBlacklist
  }
}

interface AIImageBlacklist {
  id: string
  createdAt: Date
}

interface WaitingTask {
  prompt: string
  timer: NodeJS.Timeout
  imageUrls: string[]
}

export async function apply(ctx: any, cfg: Infer<typeof Config>) {
  const debug = cfg.debug

  try {
    const loc = path.join(__dirname, 'locales', 'zh-CN.yml')
    if (fs.existsSync(loc)) {
      ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
    }
  } catch {}

  const waitingMap = new Map<string, WaitingTask>()
  const apiIdx = { val: 0 }
  const apiCallTimestamps: number[] = []

  ctx.model.extend('ai_image_blacklist', {
    id: 'string',
    createdAt: 'date',
  }, {
    primary: 'id',
  })

  ctx.on('dispose', () => {
    for (const [, task] of waitingMap) {
      clearTimeout(task.timer)
    }
    waitingMap.clear()
  })

  function checkRateLimit(): boolean {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    while (apiCallTimestamps.length > 0 && apiCallTimestamps[0] < oneHourAgo) {
      apiCallTimestamps.shift()
    }
    return apiCallTimestamps.length < cfg.rateLimit
  }

  function recordApiCall() {
    apiCallTimestamps.push(Date.now())
  }

  function getApi() {
    const list = cfg.apiList.filter(v => v.enable && v.apiKey && v.baseUrl)
    if (!list.length) return null
    if (cfg.apiStrategy === 'sequence') return list[0]
    const api = list[apiIdx.val % list.length]
    apiIdx.val++
    return api
  }

  function cleanHtmlTags(str: string) {
    return str.replace(/<[^>]+>/g, '').trim()
  }

  function getImageUrlFromContent(text: string) {
    const reg = /https?:\/\/[^<> \n\r()\[\]]+\.(png|jpg|jpeg|gif|webp)/i
    const match = text.match(reg)
    return match ? match[0] : null
  }

  async function safeSend(session: any, message: string | h) {
    try {
      await session.send(message)
    } catch (e) {
      logger.error('发送消息失败', e)
    }
  }

  function getErrorMessage(err: any): string {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') return '请求超时'
      if (err.code === 'ERR_NETWORK' || err.code?.startsWith('ERR_')) return '网络连接失败'
      if (err.response) {
        const status = err.response.status
        if (status >= 500) return `服务器错误 (${status})`
        if (status >= 400) return `请求错误 (${status})，请检查 API Key 或参数`
      }
      return err.message?.slice(0, 100) || '未知网络错误'
    }
    return '未知错误'
  }

  function extractFilenameFromAssetUrl(assetUrl: string): string | null {
    if (!assetUrl) return null
    try {
      if (assetUrl.startsWith('file://')) {
        return path.basename(assetUrl.replace('file://', ''))
      }
      const urlObj = new URL(assetUrl)
      const parts = urlObj.pathname.split('/')
      const rawName = parts[parts.length - 1] || ''
      return rawName ? path.basename(rawName) : null
    } catch {
      return null
    }
  }

  function deleteCachedFile(assetUrl: string) {
    const filename = extractFilenameFromAssetUrl(assetUrl)
    if (!filename) return
    const defaultRoot = path.join(ctx.baseDir, 'data', 'assets')
    const filePath = path.join(defaultRoot, filename)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        if (debug) logger.info('已删除缓存文件:', filePath)
      }
    } catch (e) {
      logger.error('删除缓存文件失败', e)
    }
  }

  function deleteAllCachedFiles(urls: string[]) {
    for (const url of urls) {
      deleteCachedFile(url)
    }
  }

  function isValidQQ(id: string): boolean {
    return /^\d{5,11}$/.test(id)
  }

  async function isBlacklisted(userId: string): Promise<boolean> {
    try {
      const rows = await ctx.database.get('ai_image_blacklist', { id: userId })
      return rows.length > 0
    } catch (e) {
      logger.error('查询黑名单失败', e)
      return false
    }
  }

  async function addToBlacklist(ids: string[]): Promise<{ success: string[], fail: string[] }> {
    const success: string[] = []
    const fail: string[] = []
    for (const id of ids) {
      if (!isValidQQ(id)) {
        fail.push(id)
        continue
      }
      try {
        const exists = await ctx.database.get('ai_image_blacklist', { id })
        if (exists.length === 0) {
          await ctx.database.create('ai_image_blacklist', { id, createdAt: new Date() })
          success.push(id)
        } else {
          fail.push(id)
        }
      } catch (e) {
        logger.error('添加黑名单失败', e)
        fail.push(id)
      }
    }
    return { success, fail }
  }

  async function removeFromBlacklist(ids: string[]): Promise<{ success: string[], fail: string[] }> {
    const success: string[] = []
    const fail: string[] = []
    for (const id of ids) {
      if (!isValidQQ(id)) {
        fail.push(id)
        continue
      }
      try {
        const exists = await ctx.database.get('ai_image_blacklist', { id })
        if (exists.length > 0) {
          await ctx.database.remove('ai_image_blacklist', { id })
          success.push(id)
        } else {
          fail.push(id)
        }
      } catch (e) {
        logger.error('移除黑名单失败', e)
        fail.push(id)
      }
    }
    return { success, fail }
  }

  async function generate(session: any, prompt: string, imageUrl?: string, modelOverride?: string) {
    if (!checkRateLimit()) {
      await safeSend(session, cfg.messages.rateLimit)
      return
    }

    const api = getApi()
    if (!api) {
      if (debug) logger.info('无可用API')
      await safeSend(session, cfg.messages.noApi)
      return
    }

    const model = modelOverride || cfg.model
    let content: any
    if (imageUrl) {
      content = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ]
    } else {
      content = prompt
    }

    const body = {
      model,
      messages: [{ role: 'user', content }],
    }

    if (debug) logger.info('请求体:', JSON.stringify(body, null, 2))

    try {
      recordApiCall()
      const res = await axios.post(api.baseUrl, body, {
        headers: { Authorization: `Bearer ${api.apiKey}` },
        timeout: cfg.timeout,
      })

      if (debug) logger.info('API返回:', JSON.stringify(res.data, null, 2))

      let imgUrl = res.data?.data?.[0]?.url || null
      if (!imgUrl) imgUrl = getImageUrlFromContent(res.data?.choices?.[0]?.message?.content || '')

      if (imgUrl) {
        await safeSend(session, segment.image(imgUrl.trim()))
      } else {
        const textContent = res.data?.choices?.[0]?.message?.content
        if (textContent && typeof textContent === 'string' && textContent.trim().length > 0) {
          const msg = cfg.messages.modelTextOnly.replace('{text}', textContent.trim().slice(0, 500))
          await safeSend(session, msg)
        } else {
          await safeSend(session, cfg.messages.fail + '（未返回任何内容）')
        }
      }
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
    }
  }

  async function generateWithMultipleImages(session: any, prompt: string, imageUrls: string[], modelOverride?: string) {
    if (!checkRateLimit()) {
      await safeSend(session, cfg.messages.rateLimit)
      return
    }

    const api = getApi()
    if (!api) {
      if (debug) logger.info('无可用API')
      await safeSend(session, cfg.messages.noApi)
      return
    }

    const model = modelOverride || cfg.model
    const finalPrompt = prompt.replace('{url}', imageUrls.join(', '))
    const content = [
      { type: 'text', text: finalPrompt },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
    ]

    const body = {
      model,
      messages: [{ role: 'user', content }],
    }

    if (debug) logger.info('多图请求体:', JSON.stringify(body, null, 2))

    try {
      recordApiCall()
      const res = await axios.post(api.baseUrl, body, {
        headers: { Authorization: `Bearer ${api.apiKey}` },
        timeout: cfg.timeout,
      })

      if (debug) logger.info('API返回:', JSON.stringify(res.data, null, 2))

      let imgUrl = res.data?.data?.[0]?.url || null
      if (!imgUrl) imgUrl = getImageUrlFromContent(res.data?.choices?.[0]?.message?.content || '')

      if (imgUrl) {
        await safeSend(session, segment.image(imgUrl.trim()))
      } else {
        const textContent = res.data?.choices?.[0]?.message?.content
        if (textContent && typeof textContent === 'string' && textContent.trim().length > 0) {
          const msg = cfg.messages.modelTextOnly.replace('{text}', textContent.trim().slice(0, 500))
          await safeSend(session, msg)
        } else {
          await safeSend(session, cfg.messages.fail + '（未返回任何内容）')
        }
      }
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
    } finally {
      deleteAllCachedFiles(imageUrls)
    }
  }

  const cmd = ctx.command(`${cfg.command} <raw:text>`)
  cfg.aliases.forEach(alias => cmd.alias(alias))
  cmd.action(async ({ session }: any, raw: string) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      if (!cfg.enableTxt2Img) return safeSend(session, cfg.messages.txt2imgDisabled)
      const prompt = cleanHtmlTags(raw || '')
      if (!prompt) return safeSend(session, cfg.messages.empty)
      await safeSend(session, cfg.messages.generating)
      const finalPrompt = cfg.txt2imgPrompt.replace('{prompt}', prompt)
      const model = cfg.txt2imgModel || cfg.model
      await generate(session, finalPrompt, undefined, model)
    } catch (e) {
      logger.error('文生图命令异常', e)
      await safeSend(session, cfg.messages.fail)
    }
  })

  const imgCmd = ctx.command(`${cfg.img2imgCommand} <raw:text>`)
  cfg.img2imgAliases.forEach(alias => imgCmd.alias(alias))
  imgCmd.action(async ({ session }: any, raw: string) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      if (!cfg.enableImg2Img) return safeSend(session, cfg.messages.img2imgDisabled)
      const assets = (ctx as any).assets
      if (!assets) return safeSend(session, cfg.messages.needAssets)
      const prompt = cleanHtmlTags(raw || '')
      if (!prompt) return safeSend(session, cfg.messages.empty)

      const key = `${session.guildId || 'private'}-${session.userId}`
      if (waitingMap.has(key)) {
        return safeSend(session, cfg.messages.alreadyWaiting)
      }

      await safeSend(session, cfg.messages.waitImage.replace('60', String(cfg.imgWaitTime)))
      const timer = setTimeout(() => {
        const task = waitingMap.get(key)
        if (!task) return
        waitingMap.delete(key)
        if (task.imageUrls.length > 0) {
          safeSend(session, cfg.messages.generating).catch(() => {})
          generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
        } else {
          safeSend(session, cfg.messages.timeout).catch(() => {})
        }
      }, cfg.imgWaitTime * 1000)
      waitingMap.set(key, { prompt, timer, imageUrls: [] })
    } catch (e) {
      logger.error('图生图命令异常', e)
      await safeSend(session, cfg.messages.fail)
    }
  })

  ctx.on('message', async (session: any) => {
    try {
      if (!session.elements) return
      if (session.bot?.selfId && session.userId === session.bot.selfId) return

      const key = `${session.guildId || 'private'}-${session.userId}`
      const task = waitingMap.get(key)
      if (!task) return

      const imgs = h.select(session.elements, 'img')
      if (imgs.length > 0) {
        const assets = (ctx as any).assets
        if (!assets) {
          await safeSend(session, cfg.messages.needAssets)
          return
        }

        const uploadResults = await Promise.allSettled(imgs.map(img => assets.upload(img.attrs.src, 'ref_image.jpg')))
        const newUrls: string[] = []
        for (const res of uploadResults) {
          if (res.status === 'fulfilled' && /^https?:\/\//.test(res.value)) {
            newUrls.push(res.value)
          }
        }

        if (newUrls.length === 0) {
          await safeSend(session, cfg.messages.needAssets)
          return
        }

        task.imageUrls.push(...newUrls)

        if (task.imageUrls.length >= cfg.maxImages) {
          clearTimeout(task.timer)
          waitingMap.delete(key)
          await safeSend(session, cfg.messages.generating)
          await generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
          return
        }

        clearTimeout(task.timer)
        task.timer = setTimeout(() => {
          waitingMap.delete(key)
          if (task.imageUrls.length > 0) {
            safeSend(session, cfg.messages.generating).catch(() => {})
            generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
          } else {
            safeSend(session, cfg.messages.timeout).catch(() => {})
          }
        }, cfg.imgWaitTime * 1000)
        await safeSend(session, cfg.messages.multiImageReceived.replace('{count}', String(task.imageUrls.length)))
        return
      }

      const text = session.content?.trim()
      if (text === '完成' || text === 'done' || text === '生成') {
        clearTimeout(task.timer)
        waitingMap.delete(key)
        if (task.imageUrls.length > 0) {
          await safeSend(session, cfg.messages.generating)
          await generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
        } else {
          await safeSend(session, cfg.messages.noImageReceived)
        }
      }
    } catch (e) {
      logger.error('消息监听异常', e)
      await safeSend(session, cfg.messages.fail)
    }
  })

  const blacklistCmd = ctx.command('blacklist')

  blacklistCmd.subcommand('.list', '查看黑名单').action(async ({ session }: any) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) {
      return safeSend(session, cfg.messages.noPermission)
    }

    try {
      const entries = await ctx.database.get('ai_image_blacklist', {})
      if (entries.length === 0) {
        return safeSend(session, cfg.messages.blacklistListEmpty)
      }
      const list = entries.map(e => e.id).join('\n')
      return safeSend(session, `${cfg.messages.blacklistListTitle}\n${list}`)
    } catch (e) {
      logger.error('获取黑名单失败', e)
      return safeSend(session, cfg.messages.fail)
    }
  })

  blacklistCmd.subcommand('.add <...targets:string>', '添加黑名单').action(async ({ session }: any, ...targets: string[]) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) {
      return safeSend(session, cfg.messages.noPermission)
    }

    const ids: string[] = []
    targets.forEach(t => {
      const num = t.replace(/\D/g, '')
      if (num) ids.push(num)
    })

    if (ids.length === 0) {
      return safeSend(session, '请提供有效的QQ号')
    }

    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length > 0) {
      return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    }

    const { success, fail } = await addToBlacklist(ids)
    if (success.length) {
      await safeSend(session, cfg.messages.blacklistAddSuccess.replace('{targets}', success.join(', ')))
    }
    if (fail.length) {
      await safeSend(session, cfg.messages.blacklistAddFail.replace('{targets}', fail.join(', ')))
    }
  })

  blacklistCmd.subcommand('.remove <...targets:string>', '移除黑名单').action(async ({ session }: any, ...targets: string[]) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) {
      return safeSend(session, cfg.messages.noPermission)
    }

    const ids: string[] = []
    targets.forEach(t => {
      const num = t.replace(/\D/g, '')
      if (num) ids.push(num)
    })

    if (ids.length === 0) {
      return safeSend(session, '请提供有效的QQ号')
    }

    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length > 0) {
      return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    }

    const { success, fail } = await removeFromBlacklist(ids)
    if (success.length) {
      await safeSend(session, cfg.messages.blacklistRemoveSuccess.replace('{targets}', success.join(', ')))
    }
    if (fail.length) {
      await safeSend(session, cfg.messages.blacklistRemoveFail.replace('{targets}', fail.join(', ')))
    }
  })
}