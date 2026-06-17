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
    timeout: Schema.number().default(300000).description('接口请求超时时间（毫秒）'),
    rateLimit: Schema.number().default(200).description('每小时调用次数限制'),
    imgWaitTime: Schema.number().default(60).description('图生图等待图片超时时间（秒）'),
    imageSize: Schema.string().default('1024x1024').description('全局默认图片尺寸（格式：宽x高），可被 API 条目覆盖'),
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
    ]).default('url').description('全局默认的图片数据格式（可被 API 条目覆盖）'),
  }).description('基本设置'),

  Schema.object({
    proxyEnabled: Schema.boolean().default(false).description('是否启用 HTTP/HTTPS 代理'),
    proxyProtocol: Schema.union([
      Schema.const('http').description('HTTP'),
      Schema.const('https').description('HTTPS'),
    ]).default('http').description('代理协议'),
    proxyHost: Schema.string().default('').description('代理地址'),
    proxyPort: Schema.number().default(8080).description('代理端口'),
    proxyAuth: Schema.boolean().default(false).description('代理是否需要认证'),
    proxyUsername: Schema.string().default('').description('代理用户名'),
    proxyPassword: Schema.string().role('secret').default('').description('代理密码'),
  }).description('代理设置'),

  Schema.object({
    useCustomApi: Schema.boolean().default(false).description('是否使用自定义 API 配置（开启后下方自定义列表生效）'),
    apiEndpoint: Schema.string().default('https://api.openai.com/v1/chat/completions').description('API 端点地址'),
    apiKey: Schema.string().role('secret').default('').description('API 密钥'),
    model: Schema.string().default('gpt-image-2').description('模型名称'),
    img2imgModel: Schema.string().default('').description('图生图专用模型名称（留空则使用上方模型）'),
    imageSize: Schema.string().default('').description('图片尺寸（留空则使用全局默认）'),
    responseImageFormat: Schema.union([
      Schema.const('').description('跟随全局'),
      Schema.const('url').description('URL 链接'),
      Schema.const('pure_base64').description('纯 Base64'),
    ]).default('').description('图片数据格式（留空则跟随全局设置）'),
    txt2imgPrompt: Schema.string().default('').description('文生图提示词模板。变量：{prompt}（留空则直接使用用户输入）'),
    img2imgPrompt: Schema.string().default('').description('图生图提示词模板。变量：{url} {prompt}（留空则直接使用用户输入）'),
    customHeaders: Schema.string().role('textarea').default('{}').description('自定义请求头 JSON 对象（合并到默认请求头）'),
  }).description('内置 API 设置'),

  Schema.object({
    apiStrategy: Schema.union([
      Schema.const('sequence').description('顺序模式'),
      Schema.const('roundrobin').description('负载均衡模式'),
    ]).default('roundrobin').description('API 调度策略'),
    customApiList: Schema.array(
      Schema.object({
        enable: Schema.boolean().default(true).description('是否启用此 API'),
        adapterType: Schema.union([
          Schema.const('chat').description('OpenAI 消息格式'),
          Schema.const('flat').description('原生绘图扁平格式'),
        ]).default('chat').description('接口类型'),
        endpoint: Schema.string().default('https://api.openai.com/v1/chat/completions').description('API 端点地址'),
        apiKey: Schema.string().role('secret').default('').description('API 密钥'),
        model: Schema.string().default('gpt-image-2').description('模型名称'),
        img2imgModel: Schema.string().default('').description('图生图专用模型名称（留空则使用上方模型）'),
        imageSize: Schema.string().default('').description('图片尺寸（留空则使用全局默认）'),
        responseImageFormat: Schema.union([
          Schema.const('').description('跟随全局'),
          Schema.const('url').description('URL 链接'),
          Schema.const('pure_base64').description('纯 Base64'),
        ]).default('').description('图片数据格式（留空则跟随全局设置）'),
        txt2imgPrompt: Schema.string().default('').description('文生图提示词模板。变量：{prompt}（留空则直接使用用户输入）'),
        img2imgPrompt: Schema.string().default('').description('图生图提示词模板。变量：{url} {prompt}（留空则直接使用用户输入）'),
        customHeaders: Schema.string().role('textarea')
          .default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}')
          .description('自定义请求头 JSON 对象（合并到默认请求头），支持 {apiKey} 变量'),
        bodyTemplate: Schema.string().role('textarea')
          .default(JSON.stringify({
            txt2imgBody: { model: '{model}', messages: [{ role: 'user', content: '{prompt}' }] },
            img2imgBody: { model: '{model}', messages: [{ role: 'user', content: [{ type: 'text', text: '{prompt}' }, '{{image_objects}}'] }] },
            responseImagePath: 'choices.0.message.content'
          }, null, 2))
          .description('自定义请求体 JSON 模板（高级，留空使用内置格式）。\n支持变量：{model}、{prompt}、{size}，占位符：{{image_urls}}、{{image_objects}}'),
      })
    ).default([]).description('自定义 API 配置列表（仅当"使用自定义 API 配置"开启时生效）'),
  }).description('自定义 API 配置'),

  Schema.object({
    blacklistAdmins: Schema.array(String).default([]).description('黑名单管理员的 QQ 号列表（填入QQ号即可获得黑名单管理权限，支持多个管理员）'),
  }).description('权限管理'),

  Schema.object({
    messages: Schema.object({
      generating: Schema.string().default('生成中...').description('开始生成图片时的提示'),
      waitImage: Schema.string().default('请在{time}秒内发送需要编辑的图片').description('等待用户上传图片的提示'),
      timeout: Schema.string().default('等待图片超时，已取消').description('等待图片超时取消的提示'),
      empty: Schema.string().default('[提示] 请输入提示词').description('未输入提示词时的提示'),
      noApi: Schema.string().default('[提示] 未配置可用API').description('无可用 API 时的提示'),
      fail: Schema.string().default('[提示] 生成失败').description('图片生成失败时的提示'),
      modelTextOnly: Schema.string().default('[提示] 模型未生成图片，返回文字：{text}').description('模型仅返回文字时的提示'),
      needAssets: Schema.string().default('[提示] 图生图需要正确配置 assets 服务（selfUrl 未正确设置或服务未启动）').description('缺少 assets 服务时的提示'),
      txt2imgDisabled: Schema.string().default('[提示] 文生图功能未启用').description('文生图被禁用时的提示'),
      img2imgDisabled: Schema.string().default('[提示] 图生图功能未启用').description('图生图被禁用时的提示'),
      rateLimit: Schema.string().default('[提示] 调用次数已达上限，请稍后再试').description('触发频率限制时的提示'),
      alreadyWaiting: Schema.string().default('你已在等待发送图片，请直接发送图片或等待超时').description('用户已在等待状态时的提示'),
      multiImageReceived: Schema.string().default('已收到 {count} 张图片，可继续发送或输入"完成"开始生成').description('收到多张图片时的累计提示'),
      multiImageLimit: Schema.string().default('已达到最大图片数量，自动开始生成').description('达到最大图片数量自动触发的提示'),
      noImageReceived: Schema.string().default('未发送任何图片').description('未收到任何图片时的提示'),
      blacklisted: Schema.string().default('[提示] 你已被加入黑名单，无法使用绘图功能').description('黑名单用户被拦截时的提示'),
      noPermission: Schema.string().default('[提示] 你没有权限管理黑名单').description('无黑名单管理权限时的提示'),
      blacklistAddSuccess: Schema.string().default('已将 {targets} 加入黑名单').description('黑名单添加成功的提示'),
      blacklistRemoveSuccess: Schema.string().default('已将 {targets} 移出黑名单').description('黑名单移除成功的提示'),
      blacklistAddFail: Schema.string().default('{targets} 已在黑名单中或无效').description('黑名单添加失败的提示'),
      blacklistRemoveFail: Schema.string().default('{targets} 不在黑名单中').description('黑名单移除失败的提示'),
      invalidUserId: Schema.string().default('无效的QQ号：{targets}').description('无效 QQ 号的提示'),
      blacklistListEmpty: Schema.string().default('当前黑名单为空').description('黑名单为空时的提示'),
      blacklistListTitle: Schema.string().default('当前黑名单：').description('黑名单列表标题'),
      waitCancel: Schema.string().default('已取消等待，可以重新开始').description('取消等待状态的提示'),
      waitHelp: Schema.string().default('发送图片继续，或输入"完成"开始生成，输入"取消"取消').description('等待状态下的帮助提示'),
      noLastTask: Schema.string().default('没有上一次生成记录，无法重绘').description('无重绘历史时的提示'),
      redrawing: Schema.string().default('正在重绘...').description('重绘开始时的提示'),
      redrawImg2Img: Schema.string().default('[提示] 重绘仅支持文生图任务，图生图任务请直接发起新的图生图指令').description('图生图任务无法重绘时的提示'),
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
  endpoint: string
  headers: Record<string, string>
  txt2imgBody: any
  img2imgBody: any
  responseImagePath: string
  responseImageUrlsPath: string
  method: string
  adapterType: 'chat' | 'flat'
  responseImageFormat: string
  imageSize: string
  txt2imgPrompt: string
  img2imgPrompt: string
  model: string
  img2imgModel: string
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

  const BUILTIN_CHAT_TXT2IMG = {
    model: '{model}',
    messages: [
      { role: 'user', content: '{prompt}' }
    ]
  }

  const BUILTIN_CHAT_IMG2IMG = {
    model: '{model}',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '{prompt}' },
        '{{image_objects}}'
      ]
    }]
  }

  const BUILTIN_FLAT_TXT2IMG = {
    model: '{model}',
    prompt: '{prompt}',
    size: '{size}'
  }

  const BUILTIN_FLAT_IMG2IMG = {
    model: '{model}',
    prompt: '{prompt}',
    size: '{size}',
    image_urls: '{{image_urls}}'
  }

  function parseApiEntry(entry: typeof cfg.customApiList[number]): ParsedApi | null {
    if (!entry.endpoint) return null
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (entry.apiKey) {
      headers['Authorization'] = `Bearer ${entry.apiKey}`
    }
    // 合并自定义请求头（替换 {apiKey} 占位符）
    if (entry.customHeaders) {
      try {
        const custom = JSON.parse(entry.customHeaders)
        if (custom && typeof custom === 'object') {
          for (const [k, v] of Object.entries(custom)) {
            headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, entry.apiKey || '') : String(v)
          }
        }
      } catch {
        logger.warn('customHeaders JSON 解析失败，已忽略')
      }
    }
    const adapterType = entry.adapterType || 'chat'

    let txt2imgBody: any
    let img2imgBody: any
    let responseImagePath: string

    if (entry.bodyTemplate) {
      try {
        const tmpl = JSON.parse(entry.bodyTemplate)
        txt2imgBody = tmpl.txt2imgBody || tmpl
        img2imgBody = tmpl.img2imgBody || tmpl
        responseImagePath = tmpl.responseImagePath || 'choices.0.message.content'
      } catch {
        logger.warn('bodyTemplate JSON 解析失败，使用内置模板')
        return null
      }
    } else if (adapterType === 'flat') {
      txt2imgBody = BUILTIN_FLAT_TXT2IMG
      img2imgBody = BUILTIN_FLAT_IMG2IMG
      responseImagePath = 'data.0.url'
    } else {
      txt2imgBody = BUILTIN_CHAT_TXT2IMG
      img2imgBody = BUILTIN_CHAT_IMG2IMG
      responseImagePath = 'choices.0.message.content'
    }

    return {
      endpoint: entry.endpoint,
      headers,
      txt2imgBody,
      img2imgBody,
      responseImagePath,
      responseImageUrlsPath: '',
      method: 'POST',
      adapterType,
      responseImageFormat: entry.responseImageFormat || '',
      imageSize: entry.imageSize || cfg.imageSize,
      txt2imgPrompt: entry.txt2imgPrompt || '',
      img2imgPrompt: entry.img2imgPrompt || '',
      model: entry.model,
      img2imgModel: entry.img2imgModel || '',
    }
  }

  function buildBuiltinApi(): ParsedApi {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`
    }
    // 合并内置模式的自定义请求头（替换 {apiKey} 占位符）
    if (cfg.customHeaders) {
      try {
        const custom = JSON.parse(cfg.customHeaders)
        if (custom && typeof custom === 'object') {
          for (const [k, v] of Object.entries(custom)) {
            headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, cfg.apiKey || '') : String(v)
          }
        }
      } catch {
        logger.warn('内置模式 customHeaders JSON 解析失败，已忽略')
      }
    }
    return {
      endpoint: cfg.apiEndpoint || 'https://api.openai.com/v1/chat/completions',
      headers,
      txt2imgBody: BUILTIN_CHAT_TXT2IMG,
      img2imgBody: BUILTIN_CHAT_IMG2IMG,
      responseImagePath: 'choices.0.message.content',
      responseImageUrlsPath: '',
      method: 'POST',
      adapterType: 'chat',
      responseImageFormat: cfg.responseImageFormat || '',
      imageSize: cfg.imageSize || cfg.imageSize,
      txt2imgPrompt: cfg.txt2imgPrompt || '',
      img2imgPrompt: cfg.img2imgPrompt || '',
      model: cfg.model || 'gpt-image-2',
      img2imgModel: cfg.img2imgModel || '',
    }
  }

  function getApi(): ParsedApi | null {
    if (cfg.useCustomApi) {
      const entries = cfg.customApiList.filter((e: any) => e.enable)
      if (entries.length === 0) return null
      const apis = entries
        .map((e: any) => parseApiEntry(e))
        .filter((a): a is ParsedApi => a !== null)
      if (apis.length === 0) return null
      if (cfg.apiStrategy === 'sequence') return apis[0]
      const api = apis[apiRoundRobinIdx % apis.length]
      apiRoundRobinIdx++
      return api
    } else {
      if (!cfg.apiEndpoint && !cfg.apiKey) return null
      return buildBuiltinApi()
    }
  }

  function deepReplace(obj: any, placeholder: string, replacement: any): any {
    if (obj === placeholder) return replacement
    if (Array.isArray(obj)) {
      return obj.map(item => deepReplace(item, placeholder, replacement))
    }
    if (obj && typeof obj === 'object') {
      const newObj: any = {}
      for (const key in obj) {
        newObj[key] = deepReplace(obj[key], placeholder, replacement)
      }
      return newObj
    }
    return obj
  }

  function resolveTemplate(template: any, vars: Record<string, any>): any {
    const jsonStr = JSON.stringify(template)
    let processed = jsonStr

    const placeholders: { token: string, value: any }[] = []

    if (vars.image_objects) {
      const token = `__IMG_OBJ_${Math.random().toString(36).substring(2)}__`
      placeholders.push({ token, value: vars.image_objects })
      processed = processed.replace(/"{{image_objects}}"/g, `"${token}"`)
      processed = processed.replace(/{{image_objects}}/g, token)
    }
    if (vars.image_urls) {
      const token = `__IMG_URLS_${Math.random().toString(36).substring(2)}__`
      placeholders.push({ token, value: vars.image_urls })
      processed = processed.replace(/"{{image_urls}}"/g, `"${token}"`)
      processed = processed.replace(/{{image_urls}}/g, token)
    }

    for (const [key, value] of Object.entries(vars)) {
      if (key === 'image_objects' || key === 'image_urls') continue
      if (value === undefined || value === null) continue
      const regex = new RegExp(`\\{${key}\\}`, 'g')
      processed = processed.replace(regex, JSON.stringify(String(value)).slice(1, -1))
    }

    let result = JSON.parse(processed)
    for (const { token, value } of placeholders) {
      result = deepReplace(result, token, value)
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

  function findFirstUrlInJson(obj: any): string | null {
    if (!obj) return null
    if (typeof obj === 'string') {
      const trimmed = obj.trim()
      if (/^https?:\/\//.test(trimmed)) return trimmed
      // 从文本中提取 URL（Markdown 图片链接、HTML 等）
      const match = trimmed.match(/https?:\/\/[^\s<>"')\]]+/)
      if (match) {
        return match[0].replace(/[.,;:'"]*$/, '')
      }
      return null
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFirstUrlInJson(item)
        if (found) return found
      }
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const found = findFirstUrlInJson(obj[key])
        if (found) return found
      }
    }
    return null
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
    if (/^https?:\/\//.test(str)) return str
    if (/^data:image\/[a-zA-Z]+;base64,/.test(str)) return str
    return `data:image/png;base64,${str}`
  }

  function getMimeType(url: string): string {
    const ext = url.replace(/[?#].*$/, '').split('.').pop()?.toLowerCase() || 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      svg: 'image/svg+xml', ico: 'image/x-icon', tiff: 'image/tiff',
      tif: 'image/tiff', avif: 'image/avif', heic: 'image/heic',
      heif: 'image/heif',
    }
    return mimeMap[ext] || 'image/png'
  }

  async function downloadImageAsBase64(url: string): Promise<string | null> {
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
      const rawType = res.headers['content-type']
      const contentType = (typeof rawType === 'string' ? rawType : String(rawType || ''))
      const mime = /^image\/[a-zA-Z0-9.+-]+/.test(contentType)
        ? contentType.split(';')[0].trim()
        : getMimeType(url)
      const base64 = Buffer.from(res.data).toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (e) {
      logger.warn('下载图片转换失败', url, e)
      return null
    }
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
      if (cfg.imageSendMode === 'both' || cfg.imageSendMode === 'url') {
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

    // 兜底扫描: 从 JSON 响应中查找第一个 HTTP/HTTPS URL
    if (imageUrls.length === 0) {
      const found = findFirstUrlInJson(responseData)
      if (found) imageUrls = [found]
    }

    const format = api.responseImageFormat || cfg.responseImageFormat || 'url'
    const convertedUrls: string[] = []
    for (const raw of imageUrls) {
      const seg = imageDataToSegment(raw, format)
      if (seg) {
        convertedUrls.push(seg)
      } else if (/^https?:\/\//.test(raw) && format !== 'url') {
        // API 返回的是 URL，但用户选择了 base64/data_uri → 下载后转换
        const downloaded = await downloadImageAsBase64(raw)
        if (downloaded) convertedUrls.push(downloaded)
      }
    }
    imageUrls = convertedUrls

    if (imageUrls.length > 0) {
      await sendImages(session, imageUrls)
      return
    }

    // chat 模式特有: 尝试从 choices.0.message.content 提取文本
    if (api.adapterType === 'chat') {
      const textContent = getValueByPath(responseData, 'choices.0.message.content')
      if (typeof textContent === 'string' && textContent.trim().length > 0) {
        const msg = cfg.messages.modelTextOnly.replace('{text}', textContent.trim().slice(0, 500))
        await safeSend(session, msg)
        return
      }
    }
    await safeSend(session, cfg.messages.fail + cfg.messages.noContent)
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

  function sanitizeForLog(obj: any, sensitive?: string): any {
    if (!sensitive) return obj
    try {
      const str = JSON.stringify(obj)
      const masked = str.split(sensitive).join('***')
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
    for (const entry of existing) { fail.push(entry.id) }
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
    const isImg2Img = imageUrls.length > 0
    const model = modelOverride || (isImg2Img ? (api.img2imgModel || api.model) : api.model)
    const size = api.imageSize || cfg.imageSize

    // 应用 API 层级的提示词模板
    const promptTemplate = isImg2Img ? api.img2imgPrompt : api.txt2imgPrompt
    let finalPrompt = prompt
    if (promptTemplate && isImg2Img) {
      finalPrompt = promptTemplate.replace('{prompt}', prompt).replace('{url}', imageUrls[0] || '')
    } else if (promptTemplate) {
      finalPrompt = promptTemplate.replace('{prompt}', prompt)
    }

    const bodyTemplate = isImg2Img ? api.img2imgBody : api.txt2imgBody

    const bodyVars: Record<string, any> = { model, prompt: finalPrompt, size }
    if (isImg2Img && imageUrls.length > 0) {
      bodyVars['url'] = imageUrls[0]
      bodyVars['image_urls'] = imageUrls
      bodyVars['image_objects'] = imageUrls.map(url => ({
        type: 'image_url',
        image_url: { url }
      }))
    }

    let body: any
    try {
      body = resolveTemplate(bodyTemplate, bodyVars)
    } catch (e) {
      logger.error('请求体模板解析失败', e)
      await safeSend(session, cfg.messages.fail + cfg.messages.templateError)
      return
    }

    const sensitive = api.headers?.Authorization?.split(' ')[1] || ''

    if (debug) {
      const safeBody = sanitizeForLog(body, sensitive)
      const safeHeaders = sanitizeForLog(api.headers, sensitive)
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
      // 代理配置
      if (cfg.proxyEnabled && cfg.proxyHost) {
        const proxyAuth = cfg.proxyAuth && cfg.proxyUsername
          ? { username: cfg.proxyUsername, password: cfg.proxyPassword }
          : undefined
        config.proxy = {
          protocol: cfg.proxyProtocol,
          host: cfg.proxyHost,
          port: cfg.proxyPort,
          auth: proxyAuth,
        }
      }
      if (api.method === 'GET') {
        config.params = body
      } else {
        config.data = body
      }
      const res = await axios(config)
      if (debug) logger.info('API响应', JSON.stringify(sanitizeForLog(res.data, sensitive)))

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
    } finally {
      // 清理图生图等待缓存
      const uid = `${session.guildId || 'private'}-${session.userId}`
      waitingMap.delete(uid)
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

  const cmd = ctx.command('draw <raw:text>', '文生图')
  cmd.action(async ({ session }: any, raw: string) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      if (!cfg.enableTxt2Img) return safeSend(session, cfg.messages.txt2imgDisabled)
      const prompt = (raw || '').trim()
      if (!prompt) return safeSend(session, cfg.messages.empty)
      if (prompt.length > 6000) return safeSend(session, '提示词过长，请限制在6000字符以内')
      await safeSend(session, cfg.messages.generating)
      await generate(session, prompt)
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
        generateWithMultipleImages(session, task.prompt, task.imageUrls)
      } else {
        safeSend(session, cfg.messages.timeout).catch(() => { })
      }
    }, cfg.imgWaitTime * 1000)
  }

  const imgCmd = ctx.command('imgdraw <raw:text>', '图生图')
  imgCmd.action(async ({ session }: any, raw: string) => {
    try {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      if (!cfg.enableImg2Img) return safeSend(session, cfg.messages.img2imgDisabled)

      const text = (raw || '').trim()
      if (!text) return safeSend(session, cfg.messages.empty)
      if (text.length > 6000) return safeSend(session, '提示词过长，请限制在6000字符以内')

      const urlMatch = text.match(/(https?:\/\/[^\s]+)/)
      const hasUrl = urlMatch && /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|avif|heic|heif)(\?.*)?$/i.test(urlMatch[0])
      const promptText = hasUrl ? text.replace(urlMatch![0], '').trim() : text

      if (!promptText) return safeSend(session, cfg.messages.empty)

      if (hasUrl) {
        const imageUrl = urlMatch![0]
        await safeSend(session, cfg.messages.generating)
        await generateWithMultipleImages(session, promptText, [imageUrl])
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
          await generateWithMultipleImages(session, task.prompt, task.imageUrls)
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
          await generateWithMultipleImages(session, task.prompt, task.imageUrls)
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

  const redrawCmd = ctx.command('redraw', '重绘')
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