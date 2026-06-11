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
  model: Schema.string().default('gpt-4o-mini').description('通用模型名称，文生图/图生图共用（留空则各自使用专用模型）'),
  txt2imgModel: Schema.string().default('').description('文生图专用模型名称，留空则使用上方通用模型'),
  img2imgModel: Schema.string().default('').description('图生图专用模型名称，留空则使用上方通用模型'),
  imageSize: Schema.string().default('1024x1024').description('默认图片尺寸（格式：宽x高，如 1024x1024）'),
  maxImages: Schema.number().default(5).description('图生图最大支持图片数量'),
  apiList: Schema.array(Schema.object({
    enable: Schema.boolean().default(true).description('是否启用此 API 端点'),
    apiKey: Schema.string().description('API 密钥（Bearer Token）'),
    baseUrl: Schema.string().description('接口地址，支持 Chat Completions API'),
    endpoint: Schema.string().description('自定义 API 完整 URL，支持变量：{model}=模型名称'),
    headers: Schema.string().default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}').description('请求头 JSON 模板，支持变量：{apiKey}=API 密钥'),
    txt2imgBody: Schema.string().default('{"model":"{model}","prompt":"{prompt}","size":"{size}"}').description('文生图请求体 JSON 模板。变量：{model}=模型名 {prompt}=提示词 {size}=尺寸'),
    img2imgBody: Schema.string().default('{"model":"{model}","prompt":"{prompt}","size":"{size}","image":{{image_urls}}}').description('图生图请求体 JSON 模板。变量：{model}=模型名 {prompt}=提示词 {size}=尺寸 {{image_urls}}=图片URL数组'),
    responseImagePath: Schema.string().default('data.0.url').description('响应 JSON 中图片 URL 的字段路径，用 . 和数字索引访问，如 data.0.url'),
    defaultSize: Schema.string().description('该 API 的默认图片尺寸，留空则使用全局 imageSize'),
    extraBody: Schema.string().default('').description('万能适配层：额外 JSON 字段，深度合并到请求体中。可填入 negative_prompt、steps、cfg_scale、seed、style 等任意 API 参数'),
  })).default([]).description('API 配置列表，支持多账号轮询负载均衡'),

  enableTxt2Img: Schema.boolean().default(true).description('启用文生图功能'),
  enableImg2Img: Schema.boolean().default(true).description('启用图生图功能'),

  command: Schema.string().default('draw').description('文生图触发指令'),
  aliases: Schema.array(String).default([]).description('文生图指令的额外别名'),

  img2imgCommand: Schema.string().default('imgdraw').description('图生图触发指令'),
  img2imgAliases: Schema.array(String).default([]).description('图生图指令的额外别名'),

  txt2imgPrompt: Schema.string().default('请严格遵循我的要求生成一张图片，不要询问或添加额外说明，直接输出图片。你可以使用联网功能获取最新的数据或信息。要求：{prompt}').description('文生图提示词模板。变量：{prompt}=用户输入的提示词'),
  img2imgPrompt: Schema.string().default('图片链接：{url} 请严格根据以下指令对提供的图片进行编辑或重绘，不要询问，直接输出结果。你可以使用联网功能获取最新的数据或信息。\n指令：{prompt}').description('图生图提示词模板。变量：{url}=上传后的图片链接 {prompt}=用户输入的编辑指令'),

  blacklistAdmins: Schema.array(String).default([]).description('黑名单管理员的 QQ 号列表'),

  messages: Schema.object({
    generating: Schema.string().default('⏳ 生成中...').description('正在调用 API 生成图片时的提示'),
    waitImage: Schema.string().default('请在{time}秒内发送需要编辑的图片').description('图生图等待用户上传图片的提示。变量：{time}=超时秒数'),
    timeout: Schema.string().default('等待图片超时，已取消').description('图生图等待超时后的提示'),
    empty: Schema.string().default('❌ 请输入提示词').description('用户未输入提示词时的提示'),
    noApi: Schema.string().default('❌ 未配置可用API').description('没有可用 API 时的提示'),
    fail: Schema.string().default('❌ 生成失败').description('API 调用失败时的通用提示'),
    modelTextOnly: Schema.string().default('❌ 模型未生成图片，返回文字：{text}').description('模型返回了文本而非图片时的提示。变量：{text}=模型返回的文字内容'),
    needAssets: Schema.string().default('❌ 图生图需要正确配置 assets 服务（selfUrl 未正确设置或服务未启动）').description('assets 服务未配置或不可用时的提示'),
    txt2imgDisabled: Schema.string().default('❌ 文生图功能未启用').description('文生图功能被关闭时的提示'),
    img2imgDisabled: Schema.string().default('❌ 图生图功能未启用').description('图生图功能被关闭时的提示'),
    rateLimit: Schema.string().default('❌ 调用次数已达上限，请稍后再试').description('触发频率限制时的提示'),
    alreadyWaiting: Schema.string().default('你已在等待发送图片，请直接发送图片或等待超时').description('用户重复发起图生图时的提示'),
    multiImageReceived: Schema.string().default('已收到 {count} 张图片，可继续发送或输入“完成”开始生成').description('收到多张图片后的提示。变量：{count}=已收到的图片数量'),
    multiImageLimit: Schema.string().default('已达到最大图片数量，自动开始生成').description('图片数量达到上限自动触发生成时的提示'),
    noImageReceived: Schema.string().default('未发送任何图片').description('用户输入完成但未发送图片时的提示'),
    blacklisted: Schema.string().default('❌ 你已被加入黑名单，无法使用绘图功能').description('黑名单用户尝试使用时的提示'),
    noPermission: Schema.string().default('❌ 你没有权限管理黑名单').description('非管理员操作黑名单时的提示'),
    blacklistAddSuccess: Schema.string().default('✅ 已将 {targets} 加入黑名单').description('添加黑名单成功时的提示。变量：{targets}=被加入的QQ号列表'),
    blacklistRemoveSuccess: Schema.string().default('✅ 已将 {targets} 移出黑名单').description('移除黑名单成功时的提示。变量：{targets}=被移出的QQ号列表'),
    blacklistAddFail: Schema.string().default('⚠️ {targets} 已在黑名单中或无效').description('添加黑名单失败时的提示。变量：{targets}=操作失败的QQ号列表'),
    blacklistRemoveFail: Schema.string().default('⚠️ {targets} 不在黑名单中').description('移除黑名单失败时的提示。变量：{targets}=操作失败的QQ号列表'),
    invalidUserId: Schema.string().default('⚠️ 无效的QQ号：{targets}').description('输入了无效QQ号时的提示。变量：{targets}=无效的QQ号列表'),
    blacklistListEmpty: Schema.string().default('✅ 当前黑名单为空').description('黑名单为空时的提示'),
    blacklistListTitle: Schema.string().default('📋 当前黑名单：').description('查看黑名单列表时的标题'),
  }).description('所有提示文案的自定义配置，支持模板变量'),
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

type ApiConfig = Infer<typeof Config>['apiList'][number]

export async function apply(ctx: any, cfg: Infer<typeof Config>) {
  const debug = cfg.debug

  try {
    const loc = path.join(__dirname, 'locales', 'zh-CN.yml')
    if (fs.existsSync(loc)) {
      ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
    }
  } catch {}

  const waitingMap = new Map<string, WaitingTask>()
  let apiRoundRobinIdx = 0
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

  const IMG_URL_RE = /https?:\/\/[^<> \n\r()\[\]]+\.(png|jpg|jpeg|gif|webp)/i

  function checkRateLimit(): boolean {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    let trimIdx = 0
    while (trimIdx < apiCallTimestamps.length && apiCallTimestamps[trimIdx] < oneHourAgo) {
      trimIdx++
    }
    if (trimIdx > 0) {
      apiCallTimestamps.splice(0, trimIdx)
    }
    return apiCallTimestamps.length + 1 <= cfg.rateLimit
  }

  function recordApiCall() {
    apiCallTimestamps.push(Date.now())
  }

  let cachedApiList: ApiConfig[] | null = null
  let cachedApiListKey = ''

  function getApi(): ApiConfig | null {
    const key = `${cfg.apiStrategy}|${cfg.apiList.map(a => `${a.enable}|${a.apiKey}|${a.baseUrl}|${a.endpoint}`).join(',')}`
    if (!cachedApiList || cachedApiListKey !== key) {
      cachedApiList = cfg.apiList.filter(v => v.enable && v.apiKey && (v.baseUrl || v.endpoint))
      cachedApiListKey = key
      apiRoundRobinIdx = 0
    }
    if (!cachedApiList.length) return null
    if (cfg.apiStrategy === 'sequence') return cachedApiList[0]
    const api = cachedApiList[apiRoundRobinIdx % cachedApiList.length]
    apiRoundRobinIdx++
    return api
  }

  function isCustomApi(api: ApiConfig): boolean {
    return !!api.endpoint
  }

  function resolveTemplate(template: string, vars: Record<string, any>): any {
    let result = template
    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith('__arr_')) {
        const arr = value as string[]
        const jsonArr = JSON.stringify(arr)
        result = result.replace(new RegExp(`\\{\\{${escapeRegExp(key.slice(6))}\\}\\}`, 'g'), jsonArr)
      } else {
        const strVal = typeof value === 'string' ? value : String(value)
        result = result.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g'), JSON.stringify(strVal).slice(1, -1))
      }
    }
    return JSON.parse(result)
  }

  function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) return target
    if (target === null || target === undefined) return source
    if (Array.isArray(target) && Array.isArray(source)) return [...target, ...source]
    if (typeof target !== 'object' || typeof source !== 'object') return source
    const result = { ...target }
    for (const key of Object.keys(source)) {
      result[key] = deepMerge(target[key], source[key])
    }
    return result
  }

  function getValueByPath(obj: any, pathStr: string): any {
    if (!obj || !pathStr) return undefined
    const normalized = pathStr.replace(/\[(\d+)\]/g, '.$1')
    const keys = normalized.split('.').filter(k => k !== '')
    let current = obj
    for (const key of keys) {
      if (current === undefined || current === null) return undefined
      const numKey = /^\d+$/.test(key) ? parseInt(key) : key
      current = current[numKey]
    }
    return current
  }

  function extractImageUrl(response: any, pathStr?: string): string | null {
    if (pathStr) {
      const direct = getValueByPath(response, pathStr)
      if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct
    }
    const defaultUrl = getValueByPath(response, 'data.0.url')
    if (typeof defaultUrl === 'string' && /^https?:\/\//.test(defaultUrl)) return defaultUrl

    const content = getValueByPath(response, 'choices.0.message.content')
    if (typeof content === 'string') {
      const match = content.match(IMG_URL_RE)
      if (match) return match[0]
    }
    return null
  }

  function extractImageUrlFromStandardResponse(response: any): string | null {
    let imgUrl = response?.data?.[0]?.url || null
    if (imgUrl && /^https?:\/\//.test(imgUrl)) return imgUrl
    const textContent = response?.choices?.[0]?.message?.content
    if (textContent && typeof textContent === 'string') {
      const match = textContent.match(IMG_URL_RE)
      if (match) return match[0]
    }
    return null
  }

  async function handleImageResponse(session: any, imageUrl: string | null, responseData: any) {
    if (imageUrl) {
      await safeSend(session, segment.image(imageUrl.trim()))
      return
    }
    const textContent = getValueByPath(responseData, 'choices.0.message.content')
    if (typeof textContent === 'string' && textContent.trim().length > 0) {
      const msg = cfg.messages.modelTextOnly.replace('{text}', textContent.trim().slice(0, 500))
      await safeSend(session, msg)
    } else {
      await safeSend(session, cfg.messages.fail + '（未返回任何内容）')
    }
  }

  function validateEndpointUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
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
      if (err.code === 'ECONNABORTED') return '请求超时，请稍后重试'
      if (err.code === 'ERR_NETWORK' || err.code?.startsWith('ERR_')) return '网络连接失败，请检查网络或API地址'
      if (err.response) {
        const status = err.response.status
        const statusMessages: Record<number, string> = {
          400: '请求参数错误',
          401: 'API Key 无效或已过期',
          403: '无权访问该资源',
          404: 'API 端点不存在',
          429: '请求过于频繁，请稍后重试',
        }
        if (statusMessages[status]) return `${statusMessages[status]} (${status})`
        if (status >= 500) return `服务器内部错误 (${status})，请稍后重试`
        if (status >= 400) return `请求错误 (${status})`
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

  async function customGenerate(
    session: any,
    api: ApiConfig,
    prompt: string,
    imageUrls: string[] = [],
    modelOverride?: string
  ) {
    const model = modelOverride || cfg.model
    const size = api.defaultSize || cfg.imageSize

    const endpointTemplate = api.endpoint || api.baseUrl
    const headersTemplate = api.headers || '{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}'

    const bodyTemplate = imageUrls.length > 0 ? api.img2imgBody : api.txt2imgBody

    const endpoint = endpointTemplate.replace(/\{model\}/g, model)

    const headersVars: Record<string, any> = { apiKey: api.apiKey }
    const headers = resolveTemplate(headersTemplate, headersVars)

    const bodyVars: Record<string, any> = {
      model,
      prompt,
      size,
    }
    if (imageUrls.length > 0) {
      bodyVars['__arr_image_urls'] = imageUrls
    }

    let body: any
    try {
      body = resolveTemplate(bodyTemplate, bodyVars)
    } catch (e) {
      logger.error('请求体模板解析失败', e)
      await safeSend(session, cfg.messages.fail + '（模板配置错误）')
      return
    }

    if (api.extraBody) {
      try {
        const extra = JSON.parse(api.extraBody)
        body = deepMerge(body, extra)
      } catch (e) {
        logger.error('extraBody JSON 解析失败', e)
        await safeSend(session, cfg.messages.fail + '（extraBody 配置错误）')
        return
      }
    }

    if (debug) logger.info('自定义请求:', endpoint, JSON.stringify(body, null, 2))

    if (!validateEndpointUrl(endpoint)) {
      logger.error('无效的API端点URL:', endpoint)
      await safeSend(session, cfg.messages.fail + '（API端点配置无效）')
      return
    }

    try {
      const res = await axios.post(endpoint, body, {
        headers,
        timeout: cfg.timeout,
      })

      if (debug) logger.info('自定义响应:', JSON.stringify(res.data, null, 2))

      const imgUrl = extractImageUrl(res.data, api.responseImagePath)
      await handleImageResponse(session, imgUrl, res.data)
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`自定义API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
    } finally {
      if (imageUrls.length > 0) {
        deleteAllCachedFiles(imageUrls)
      }
    }
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

    recordApiCall()

    if (isCustomApi(api)) {
      return customGenerate(session, api, prompt, imageUrl ? [imageUrl] : [], modelOverride)
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
      const res = await axios.post(api.baseUrl, body, {
        headers: { Authorization: `Bearer ${api.apiKey}` },
        timeout: cfg.timeout,
      })

      if (debug) logger.info('API返回:', JSON.stringify(res.data, null, 2))

      const imgUrl = extractImageUrlFromStandardResponse(res.data)
      await handleImageResponse(session, imgUrl, res.data)
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

    recordApiCall()

    if (isCustomApi(api)) {
      return customGenerate(session, api, prompt, imageUrls, modelOverride)
    }

    const model = modelOverride || cfg.model
    const finalPrompt = prompt.replace(/\{url\}/g, imageUrls.join(', '))
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
      const res = await axios.post(api.baseUrl, body, {
        headers: { Authorization: `Bearer ${api.apiKey}` },
        timeout: cfg.timeout,
      })

      if (debug) logger.info('API返回:', JSON.stringify(res.data, null, 2))

      const imgUrl = extractImageUrlFromStandardResponse(res.data)
      await handleImageResponse(session, imgUrl, res.data)
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
    } finally {
      deleteAllCachedFiles(imageUrls)
    }
  }

  const cmd = ctx.command(`${cfg.command} <raw:text>`, 'draw')
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

  function createImageWaitTimer(session: any, key: string, task: WaitingTask): NodeJS.Timeout {
    return setTimeout(() => {
      waitingMap.delete(key)
      if (task.imageUrls.length > 0) {
        safeSend(session, cfg.messages.generating).catch(() => {})
        generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
      } else {
        safeSend(session, cfg.messages.timeout).catch(() => {})
      }
    }, cfg.imgWaitTime * 1000)
  }

  const imgCmd = ctx.command(`${cfg.img2imgCommand} <raw:text>`, 'imgdraw')
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

      await safeSend(session, cfg.messages.waitImage.replace('{time}', String(cfg.imgWaitTime)))
      const task: WaitingTask = { prompt, timer: null as any, imageUrls: [] }
      task.timer = createImageWaitTimer(session, key, task)
      waitingMap.set(key, task)
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
        task.timer = createImageWaitTimer(session, key, task)
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

  const blacklistCmd = ctx.command('blacklist', 'blacklist')

  blacklistCmd.subcommand('.list', 'blacklist.list').action(async ({ session }: any) => {
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

  blacklistCmd.subcommand('.add <...targets:string>', 'blacklist.add').action(async ({ session }: any, ...targets: string[]) => {
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

  blacklistCmd.subcommand('.remove <...targets:string>', 'blacklist.remove').action(async ({ session }: any, ...targets: string[]) => {
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

  function cleanHtmlTags(str: string) {
    return str.replace(/<[^>]+>/g, '').trim()
  }
}