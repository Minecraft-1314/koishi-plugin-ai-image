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

export const Config = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().default(false).description('开启调试模式，输出完整请求日志'),
    apiStrategy: Schema.union([
      Schema.const('sequence').description('顺序模式'),
      Schema.const('roundrobin').description('负载均衡模式'),
    ]).default('roundrobin').description('API 调度策略'),
    timeout: Schema.number().default(300000).description('接口请求超时时间（毫秒）'),
    rateLimit: Schema.number().default(200).description('每小时调用次数限制'),
    imgWaitTime: Schema.number().default(60).description('图生图等待图片超时时间（秒）'),
    model: Schema.string().default('gpt-image-2').description('通用模型名称，文生图/图生图共用。'),
    txt2imgModel: Schema.string().default('').description('文生图专用模型名称，留空则使用上方通用模型'),
    img2imgModel: Schema.string().default('').description('图生图专用模型名称，留空则使用上方通用模型'),
    imageSize: Schema.string().default('1024x1024').description('默认图片尺寸（格式：宽x高，如 1024x1024）'),
    maxImages: Schema.number().default(5).description('图生图最大支持图片数量'),
    imageSendMode: Schema.union([
      Schema.const('image').description('仅发送图片'),
      Schema.const('url').description('仅发送链接'),
      Schema.const('both').description('发送图片和链接'),
    ]).default('image').description('生成结果发送方式'),
    enableForward: Schema.boolean().default(true).description('多图结果是否使用合并转发'),
    enableTxt2Img: Schema.boolean().default(true).description('启用文生图功能'),
    enableImg2Img: Schema.boolean().default(true).description('启用图生图功能'),
    responseImageFormat: Schema.union([
      Schema.const('url').description('URL 链接'),
      Schema.const('pure_base64').description('纯 Base64'),
      Schema.const('data_uri').description('Data URI'),
    ]).default('url').description('图片数据格式'),
  }).description('基本设置'),

  Schema.object({
    apiList: Schema.array(
      Schema.object({
        enable: Schema.boolean().default(true).description('是否启用此 API 端点'),
        example: Schema.string()
          .role('textarea')
          .default(JSON.stringify({
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: 'sk-xxxx',
            headers: {
              'Authorization': 'Bearer {apiKey}',
              'Content-Type': 'application/json'
            },
            txt2imgBody: {
              model: '{model}',
              messages: [
                { role: 'user', content: '{prompt}' }
              ]
            },
            img2imgBody: {
              model: '{model}',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: '{prompt}' },
                  '{{image_objects}}'
                ]
              }]
            },
            responseImagePath: 'choices.0.message.content'
          }, null, 2))
          .description(
            '完整的 API 请求范式 JSON。\n' +
            '必须包含：endpoint, apiKey, headers, txt2imgBody, img2imgBody, responseImagePath。\n' +
            '支持变量：{model}（模型名）、{prompt}（提示词）、{size}（尺寸）、{url}（图生图时第一张图片链接）、{{image_urls}}（图片 URL 数组）、{{image_objects}}（Chat Completions 风格图片对象列表）、{apiKey}（API密钥）。\n' +
            '请根据 API 类型选用 {{image_urls}} 或 {{image_objects}}。'
          ),
      })
    ).default([]).description('API 配置列表，支持多账号轮询负载均衡'),
  }).description('API 配置'),

  Schema.object({
    command: Schema.string().default('draw').description('文生图触发指令'),
    aliases: Schema.array(String).default([]).description('文生图指令的额外别名'),
    img2imgCommand: Schema.string().default('imgdraw').description('图生图触发指令'),
    img2imgAliases: Schema.array(String).default([]).description('图生图指令的额外别名'),
    redrawCommand: Schema.string().default('redraw').description('重绘指令'),
    redrawAliases: Schema.array(String).default(['rd', '重绘']).description('重绘指令别名'),
  }).description('指令设置'),

  Schema.object({
    txt2imgPrompt: Schema.string().default('请严格遵循我的要求生成一张图片，不要询问或添加额外说明，直接输出图片。要求：{prompt}').description('文生图提示词模板。变量：{prompt}=用户输入的提示词'),
    img2imgPrompt: Schema.string().default('图片链接：{url} 请严格根据以下指令对提供的图片进行编辑或重绘，不要询问，直接输出结果。\n指令：{prompt}').description('图生图提示词模板。变量：{url}=上传后的图片链接 {prompt}=用户输入的编辑指令'),
  }).description('提示词模板'),

  Schema.object({
    blacklistAdmins: Schema.array(String).default([]).description('黑名单管理员的 QQ 号列表'),
  }).description('权限管理'),

  Schema.object({
    messages: Schema.object({
      generating: Schema.string().default('生成中...'),
      waitImage: Schema.string().default('请在{time}秒内发送需要编辑的图片'),
      timeout: Schema.string().default('等待图片超时，已取消'),
      empty: Schema.string().default('[提示] 请输入提示词'),
      noApi: Schema.string().default('[提示] 未配置可用API'),
      fail: Schema.string().default('[提示] 生成失败'),
      modelTextOnly: Schema.string().default('[提示] 模型未生成图片，返回文字：{text}'),
      needAssets: Schema.string().default('[提示] 图生图需要正确配置 assets 服务（selfUrl 未正确设置或服务未启动）'),
      txt2imgDisabled: Schema.string().default('[提示] 文生图功能未启用'),
      img2imgDisabled: Schema.string().default('[提示] 图生图功能未启用'),
      rateLimit: Schema.string().default('[提示] 调用次数已达上限，请稍后再试'),
      alreadyWaiting: Schema.string().default('你已在等待发送图片，请直接发送图片或等待超时'),
      multiImageReceived: Schema.string().default('已收到 {count} 张图片，可继续发送或输入"完成"开始生成'),
      multiImageLimit: Schema.string().default('已达到最大图片数量，自动开始生成'),
      noImageReceived: Schema.string().default('未发送任何图片'),
      blacklisted: Schema.string().default('[提示] 你已被加入黑名单，无法使用绘图功能'),
      noPermission: Schema.string().default('[提示] 你没有权限管理黑名单'),
      blacklistAddSuccess: Schema.string().default('已将 {targets} 加入黑名单'),
      blacklistRemoveSuccess: Schema.string().default('已将 {targets} 移出黑名单'),
      blacklistAddFail: Schema.string().default('{targets} 已在黑名单中或无效'),
      blacklistRemoveFail: Schema.string().default('{targets} 不在黑名单中'),
      invalidUserId: Schema.string().default('无效的QQ号：{targets}'),
      blacklistListEmpty: Schema.string().default('当前黑名单为空'),
      blacklistListTitle: Schema.string().default('当前黑名单：'),
      waitCancel: Schema.string().default('已取消等待，可以重新开始'),
      waitHelp: Schema.string().default('发送图片继续，或输入"完成"开始生成，输入"取消"取消'),
      noLastTask: Schema.string().default('没有上一次生成记录，无法重绘'),
      redrawing: Schema.string().default('正在重绘...'),
      redrawImg2Img: Schema.string().default('[提示] 重绘仅支持文生图任务，图生图任务请直接发起新的图生图指令'),
      noContent: Schema.string().default('（未返回任何内容）').description('API 返回空结果时的追加提示'),
      templateError: Schema.string().default('（模板配置错误）').description('请求体模板解析失败时的追加提示'),
    }).description('所有提示文案的自定义配置，支持模板变量'),
  }).description('消息文本'),
])

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

interface LastTask {
  prompt: string
  imageUrls: string[]
  isImg2Img: boolean
  model: string
}

interface ParsedApi {
  enable: boolean
  endpoint: string
  headers: Record<string, string>
  txt2imgBody: string
  img2imgBody: string
  responseImagePath: string
  responseImageUrlsPath: string
  method: string
}

export async function apply(ctx: any, cfg: Infer<typeof Config>) {
  const debug = cfg.debug

  try {
    const loc = path.join(__dirname, 'locales', 'zh-CN.yml')
    if (fs.existsSync(loc)) {
      ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
    }
  } catch { }

  const waitingMap = new Map<string, WaitingTask>()
  const lastTaskMap = new Map<string, LastTask>()
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

  function parseApiExample(raw: string): ParsedApi | null {
    try {
      const obj = JSON.parse(raw)
      if (!obj.endpoint) return null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (obj.headers && typeof obj.headers === 'object') {
        for (const [k, v] of Object.entries(obj.headers)) {
          if (typeof v === 'string') {
            headers[k] = v.replace(/\{apiKey\}/g, obj.apiKey || '')
          }
        }
      }
      return {
        enable: true,
        endpoint: String(obj.endpoint),
        headers,
        txt2imgBody: typeof obj.txt2imgBody === 'string' ? obj.txt2imgBody : JSON.stringify(obj.txt2imgBody),
        img2imgBody: typeof obj.img2imgBody === 'string' ? obj.img2imgBody : JSON.stringify(obj.img2imgBody),
        responseImagePath: obj.responseImagePath || 'choices.0.message.content',
        responseImageUrlsPath: obj.responseImageUrlsPath || '',
        method: (obj.method || 'POST').toUpperCase(),
      }
    } catch {
      return null
    }
  }

  let cachedApis: ParsedApi[] | null = null
  let cachedApiListKey = ''

  function getApi(): ParsedApi | null {
    const key = cfg.apiList.map(a => `${a.enable}|${a.example}`).join(',')
    if (cachedApis === null || cachedApiListKey !== key) {
      cachedApis = cfg.apiList
        .filter(item => item.enable)
        .map(item => parseApiExample(item.example))
        .filter((api): api is ParsedApi => api !== null)
      cachedApiListKey = key
      apiRoundRobinIdx = 0
    }
    if (!cachedApis.length) return null
    if (cfg.apiStrategy === 'sequence') return cachedApis[0]
    const api = cachedApis[apiRoundRobinIdx % cachedApis.length]
    apiRoundRobinIdx++
    return api
  }

  function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function resolveTemplate(template: string, vars: Record<string, any>): any {
    let result = template
    const directVars = ['image_urls', 'image_objects']
    for (const key of directVars) {
      if (key in vars && typeof vars[key] === 'string') {
        const regex = new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g')
        result = result.replace(regex, vars[key] as string)
        delete vars[key]
      }
    }
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined || value === null) continue
      const strVal = JSON.stringify(value)
      const regex = new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g')
      result = result.replace(regex, () => strVal.slice(1, -1))
    }
    return JSON.parse(result)
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

  function extractImagesByPath(obj: any, pathStr: string): string[] {
    if (!pathStr) return []
    if (pathStr.includes('#')) {
      const parts = pathStr.split('#')
      if (parts.length !== 2) return []
      const arrPath = parts[0].replace(/\.$/, '')
      const itemPath = parts[1].replace(/^\./, '')
      const arr = arrPath ? getValueByPath(obj, arrPath) : obj
      if (!Array.isArray(arr)) return []
      return arr.map(item => {
        const val = itemPath ? getValueByPath(item, itemPath) : item
        return val === undefined || val === null ? '' : String(val).trim()
      }).filter(Boolean)
    }
    const val = getValueByPath(obj, pathStr)
    if (Array.isArray(val)) return val.map(String).filter(Boolean)
    if (val) return [String(val).trim()]
    return []
  }

  function imageDataToSegment(raw: string, format: string): string | null {
    const str = raw.trim()
    if (!str) return null
    if (format === 'url') {
      return /^https?:\/\//.test(str) ? str : null
    }
    if (format === 'pure_base64') {
      if (/^https?:\/\//.test(str)) return null
      if (/^data:image\/[a-zA-Z]+;base64,/.test(str)) return str
      return `data:image/png;base64,${str}`
    }
    if (format === 'data_uri') {
      if (/^data:image\/[a-zA-Z]+;base64,/.test(str)) return str
      if (/^https?:\/\//.test(str)) return null
      return `data:image/png;base64,${str}`
    }
    if (/^https?:\/\//.test(str)) return str
    if (/^data:image\/[a-zA-Z]+;base64,/.test(str)) return str
    return `data:image/png;base64,${str}`
  }

  function buildForwardMessage(imageUrls: string[], userId: string, nickname = '绘图结果') {
    const nodes = imageUrls.map(url => h('message', {}, h('author', { id: userId, name: nickname }), h('img', { src: url })))
    return h('message', { forward: true }, ...nodes)
  }

  async function sendSingleImage(session: any, url: string) {
    const mode = cfg.imageSendMode
    if (mode === 'image') {
      await safeSend(session, segment.image(url))
    } else if (mode === 'url') {
      await safeSend(session, url)
    } else if (mode === 'both') {
      await safeSend(session, segment.image(url))
      await safeSend(session, url)
    }
  }

  async function sendImages(session: any, imageUrls: string[]) {
    if (!imageUrls || imageUrls.length === 0) {
      await safeSend(session, cfg.messages.fail + '（未生成任何图片）')
      return
    }
    if (imageUrls.length === 1) {
      await sendSingleImage(session, imageUrls[0])
      return
    }
    if (cfg.enableForward) {
      const forward = buildForwardMessage(imageUrls, session.userId, session.author?.nickname || session.username)
      await safeSend(session, forward)
      if (cfg.imageSendMode === 'both') {
        for (const url of imageUrls) {
          await safeSend(session, url)
        }
      } else if (cfg.imageSendMode === 'url') {
        for (const url of imageUrls) {
          await safeSend(session, url)
        }
      }
    } else {
      for (const url of imageUrls) {
        await sendSingleImage(session, url)
      }
    }
  }

  async function handleImageResponse(session: any, responseData: any, api: ParsedApi) {
    let imageUrls: string[] = []

    if (api.responseImageUrlsPath) {
      imageUrls = extractImagesByPath(responseData, api.responseImageUrlsPath)
    }
    if (imageUrls.length === 0 && api.responseImagePath) {
      imageUrls = extractImagesByPath(responseData, api.responseImagePath)
    }

    const format = cfg.responseImageFormat || 'url'
    imageUrls = imageUrls.map(raw => imageDataToSegment(raw, format)).filter((url): url is string => url !== null)

    if (imageUrls.length > 0) {
      await sendImages(session, imageUrls)
      return
    }

    const textContent = getValueByPath(responseData, 'choices.0.message.content')
    if (typeof textContent === 'string' && textContent.trim().length > 0) {
      const msg = cfg.messages.modelTextOnly.replace('{text}', textContent.trim().slice(0, 500))
      await safeSend(session, msg)
    } else {
      await safeSend(session, cfg.messages.fail + cfg.messages.noContent)
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

  function sanitizeForLog(obj: any, apiKey?: string): any {
    if (!apiKey) return obj
    try {
      const str = JSON.stringify(obj)
      const masked = str.replace(new RegExp(escapeRegExp(apiKey), 'g'), '***')
      return JSON.parse(masked)
    } catch {
      return obj
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
    const validIds = ids.filter(id => { if (isValidQQ(id)) return true; fail.push(id); return false })
    if (validIds.length === 0) return { success, fail }
    const existing = await ctx.database.get('ai_image_blacklist', { id: validIds })
    const existingSet = new Set(existing.map((e: any) => e.id))
    const toCreate = validIds.filter(id => !existingSet.has(id))
    for (const id of toCreate) {
      try {
        await ctx.database.create('ai_image_blacklist', { id, createdAt: new Date() })
        success.push(id)
      } catch (e) {
        logger.error('添加黑名单失败', e)
        fail.push(id)
      }
    }
    for (const id of existing) { fail.push(id.id) }
    return { success, fail }
  }

  async function removeFromBlacklist(ids: string[]): Promise<{ success: string[], fail: string[] }> {
    const success: string[] = []
    const fail: string[] = []
    const validIds = ids.filter(id => { if (isValidQQ(id)) return true; fail.push(id); return false })
    if (validIds.length === 0) return { success, fail }
    const existing = await ctx.database.get('ai_image_blacklist', { id: validIds })
    const existingSet = new Set(existing.map((e: any) => e.id))
    const toRemove = validIds.filter(id => existingSet.has(id))
    for (const id of toRemove) {
      try {
        await ctx.database.remove('ai_image_blacklist', { id })
        success.push(id)
      } catch (e) {
        logger.error('移除黑名单失败', e)
        fail.push(id)
      }
    }
    for (const id of validIds.filter(id => !existingSet.has(id))) { fail.push(id) }
    return { success, fail }
  }

  async function customGenerate(
    session: any,
    api: ParsedApi,
    prompt: string,
    imageUrls: string[] = [],
    modelOverride?: string
  ) {
    const model = modelOverride || cfg.model
    const size = cfg.imageSize
    const isImg2Img = imageUrls.length > 0
    const bodyTemplate = isImg2Img ? api.img2imgBody : api.txt2imgBody

    const bodyVars: Record<string, any> = { model, prompt, size }
    if (isImg2Img && imageUrls.length > 0) {
      bodyVars['url'] = imageUrls[0]
      bodyVars['image_urls'] = JSON.stringify(imageUrls)
      bodyVars['image_objects'] = imageUrls
        .map(url => JSON.stringify({ type: 'image_url', image_url: { url } }))
        .join(', ')
    }

    let body: any
    try {
      body = resolveTemplate(bodyTemplate, bodyVars)
    } catch (e) {
      logger.error('请求体模板解析失败', e)
      await safeSend(session, cfg.messages.fail + cfg.messages.templateError)
      return
    }

    if (debug) {
      const safeBody = sanitizeForLog(body, api.headers?.Authorization?.split(' ')[1] || '')
      const safeHeaders = sanitizeForLog(api.headers, api.headers?.Authorization?.split(' ')[1] || '')
      logger.info('API请求', api.endpoint, JSON.stringify(safeBody), JSON.stringify(safeHeaders))
    }

    if (!validateEndpointUrl(api.endpoint)) {
      logger.error('无效的API端点URL:', api.endpoint)
      await safeSend(session, cfg.messages.fail + '（API端点配置无效）')
      return
    }

    try {
      const config: any = {
        url: api.endpoint,
        method: api.method,
        headers: api.headers,
        timeout: cfg.timeout,
      }
      if (api.method === 'GET') {
        config.params = body
      } else {
        config.data = body
      }
      const res = await axios(config)
      if (debug) logger.info('API响应', JSON.stringify(sanitizeForLog(res.data, api.headers?.Authorization?.split(' ')[1] || '')))

      await handleImageResponse(session, res.data, api)

      const userId = `${session.guildId || 'private'}-${session.userId}`
      lastTaskMap.set(userId, {
        prompt,
        imageUrls: isImg2Img ? imageUrls : [],
        isImg2Img,
        model,
      })
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
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
    return customGenerate(session, api, prompt, imageUrl ? [imageUrl] : [], modelOverride)
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
    return customGenerate(session, api, prompt, imageUrls, modelOverride)
  }

  const cmd = ctx.command(`${cfg.command} <raw:text>`, 'draw')
  cfg.aliases.forEach(alias => cmd.alias(alias))
  cmd.action(async ({ session }: any, raw: string) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      if (!cfg.enableTxt2Img) return safeSend(session, cfg.messages.txt2imgDisabled)
      const prompt = (raw || '').trim()
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
        safeSend(session, cfg.messages.generating).catch(() => { })
        generateWithMultipleImages(session, task.prompt, task.imageUrls, cfg.img2imgModel || cfg.model)
      } else {
        safeSend(session, cfg.messages.timeout).catch(() => { })
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

      const text = (raw || '').trim()
      if (!text) return safeSend(session, cfg.messages.empty)

      const urlMatch = text.match(/(https?:\/\/[^\s]+)/)
      const hasUrl = urlMatch && /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(urlMatch[0])
      const promptText = hasUrl ? text.replace(urlMatch![0], '').trim() : text

      if (!promptText) return safeSend(session, cfg.messages.empty)

      if (hasUrl) {
        const imageUrl = urlMatch![0]
        await safeSend(session, cfg.messages.generating)
        const finalPrompt = cfg.img2imgPrompt
          .replace('{url}', imageUrl)
          .replace('{prompt}', promptText)
        await generateWithMultipleImages(session, finalPrompt, [imageUrl], cfg.img2imgModel || cfg.model)
        return
      }

      const assets = (ctx as any).assets
      if (!assets) return safeSend(session, cfg.messages.needAssets)

      const key = `${session.guildId || 'private'}-${session.userId}`
      if (waitingMap.has(key)) {
        return safeSend(session, cfg.messages.alreadyWaiting)
      }

      await safeSend(session, cfg.messages.waitImage.replace('{time}', String(cfg.imgWaitTime)))
      const task: WaitingTask = { prompt: promptText, timer: null as any, imageUrls: [] }
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
        return
      }

      if (text === '取消' || text === 'cancel') {
        clearTimeout(task.timer)
        waitingMap.delete(key)
        await safeSend(session, cfg.messages.waitCancel)
        return
      }

      if (text && !['完成', 'done', '生成', '取消', 'cancel'].includes(text)) {
        await safeSend(session, cfg.messages.waitHelp)
      }
    } catch (e) {
      logger.error('消息监听异常', e)
      await safeSend(session, cfg.messages.fail)
    }
  })

  const redrawCmd = ctx.command(`${cfg.redrawCommand}`, 'redraw')
  cfg.redrawAliases.forEach(alias => redrawCmd.alias(alias))
  redrawCmd.action(async ({ session }: any) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)

      const userId = `${session.guildId || 'private'}-${session.userId}`
      const last = lastTaskMap.get(userId)
      if (!last) return safeSend(session, cfg.messages.noLastTask)

      if (last.isImg2Img) {
        return safeSend(session, cfg.messages.redrawImg2Img)
      }

      await safeSend(session, cfg.messages.redrawing)
      await generate(session, last.prompt, undefined, last.model)
    } catch (e) {
      logger.error('重绘命令异常', e)
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
    const ids = targets.map(t => t.trim()).filter(id => id.length > 0)
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
    const ids = targets.map(t => t.trim()).filter(id => id.length > 0)
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