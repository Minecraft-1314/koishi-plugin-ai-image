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
  model: Schema.string().default('gpt-image-2').description('通用模型名称，文生图/图生图共用。GPT Image 2/1.5 使用 Chat Completions；DALL·E 3 使用 Images API'),
  txt2imgModel: Schema.string().default('').description('文生图专用模型名称，留空则使用上方通用模型'),
  img2imgModel: Schema.string().default('').description('图生图专用模型名称，留空则使用上方通用模型'),
  imageSize: Schema.string().default('1024x1024').description('默认图片尺寸（格式：宽x高，如 1024x1024）'),
  maxImages: Schema.number().default(5).description('图生图最大支持图片数量'),
  apiList: Schema.array(Schema.object({
    enable: Schema.boolean().default(true).description('是否启用此 API 端点'),
    backend: Schema.string().default('custom').description('后端类型(41家)：custom / agnes / openai / stability / leonardo / replicate / flux / midjourney / getimg / ideogram / venice / prodia / deepai / recraft / imagen / xai / microsoft / firefly / luma / zai / amazon / baidu / aliyun / tencent / seedream / huawei / xfyun / sense / meitu / minimax / kuaishou / stepfun / openrouter / together / fal / segmind / deepinfra / atlas / comet / wavespeed / qiniu'),
    apiKey: Schema.string().description('API 密钥（Bearer Token 或平台专用 Key）'),
    baseUrl: Schema.string().description('接口地址，支持 Chat Completions API'),
    endpoint: Schema.string().description('自定义 API 完整 URL，支持变量：{model}=模型名称'),
    headers: Schema.string().default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}').description('请求头 JSON 模板，支持变量：{apiKey}=API 密钥'),
    txt2imgBody: Schema.string().default('{"model":"{model}","prompt":"{prompt}","size":"{size}"}').description('文生图请求体 JSON 模板（backend=custom 时生效）。变量：{model}=模型名 {prompt}=提示词 {size}=尺寸'),
    img2imgBody: Schema.string().default('{"model":"{model}","prompt":"{prompt}","size":"{size}","image":{{image_urls}}}').description('图生图请求体 JSON 模板（backend=custom 时生效）。变量：{model}=模型名 {prompt}=提示词 {size}=尺寸 {{image_urls}}=图片URL数组'),
    responseImagePath: Schema.string().default('data.0.url').description('响应 JSON 中图片 URL 的字段路径，用 . 和数字索引访问，如 data.0.url'),
    defaultSize: Schema.string().description('该 API 的默认图片尺寸（WxH），留空则使用全局 imageSize'),
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

  function parseSize(sizeStr: string): { width: number, height: number } {
    const parts = sizeStr.split('x')
    const w = parseInt(parts[0]) || 1024
    const h = parseInt(parts[1]) || 1024
    return { width: w, height: h }
  }

  function ensureBase64DataUri(url: string): string {
    if (/^https?:\/\//.test(url)) return url
    if (/^data:/.test(url)) return url
    return `data:image/png;base64,${url}`
  }

  interface BackendResult {
    endpoint: string
    body: any
    warnings: string[]
    headers?: string
    responseImagePath?: string
  }

  function buildAgnesBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://apihub.agnes-ai.com/v1/images/generations'
    const isImg2Img = imageUrls.length > 0
    const warnings: string[] = []
    const body: any = { model, prompt, size: `${width}x${height}` }
    const extra: any = {}

    if (outputFormat === 'base64' && !isImg2Img) {
      body.return_base64 = true
    } else if (outputFormat === 'base64' && isImg2Img) {
      extra.response_format = 'b64_json'
    } else {
      extra.response_format = 'url'
    }

    if (isImg2Img) {
      extra.image = imageUrls.map(u => ensureBase64DataUri(u))
    }

    if (Object.keys(extra).length > 0) {
      body.extra_body = extra
    }

    warnings.push('Agnes 不支持: negative_prompt, num_outputs(固定1张), seed, steps, cfg_scale, sampler, mask, strength, style, extensions')

    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildOpenAIBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const isDalle3 = model.includes('dall-e-3')
    const isGptImage = model.includes('gpt-image')
    const warnings: string[] = []
    let endpoint = api.endpoint || (isGptImage
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.openai.com/v1/images/generations')

    let body: any
    let responsePath = 'data.0.url'

    if (isGptImage) {
      const content: any[] = [{ type: 'text', text: prompt }]
      if (imageUrls.length > 0) {
        content.push(...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })))
      }
      body = { model, messages: [{ role: 'user', content }] }
      responsePath = 'choices.0.message.content'
      warnings.push('GPT Image 使用 Chat Completions API，返回格式为 Markdown 图片链接')
    } else {
      body = { model, prompt, n: 1, response_format: outputFormat === 'base64' ? 'b64_json' : 'url' }
      if (isDalle3) {
        const validSizes = ['1024x1024', '1792x1024', '1024x1792']
        const candidate = `${width}x${height}`
        body.size = validSizes.includes(candidate) ? candidate : '1024x1024'
        if (body.size !== candidate) warnings.push(`DALL·E 3 尺寸调整为 ${body.size}`)
        body.quality = 'standard'
      } else {
        body.size = `${width}x${height}`
      }
      if (imageUrls.length > 0) {
        if (isDalle3) {
          warnings.push('DALL·E 3 不支持图生图/编辑，已降级为文生图')
        } else {
          endpoint = 'https://api.openai.com/v1/images/edits'
          body.image = imageUrls[0]
          if (imageUrls.length > 1) body.mask = imageUrls[1]
          delete body.n
          delete body.response_format
          delete body.size
        }
      }
    }

    if (!isGptImage && api.extraBody) {
      try { const eb = JSON.parse(api.extraBody); if (eb.style) body.style = eb.style } catch {}
    }

    warnings.push('OpenAI 不支持: negative_prompt, steps, cfg_scale, sampler, extensions')

    return { endpoint, body, warnings, responseImagePath: responsePath }
  }

  function buildStabilityBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const engineId = model || 'stable-diffusion-3.5-large'
    const baseUrl = 'https://api.stability.ai/v1/generation'
    const isImg2Img = imageUrls.length > 0
    const warnings: string[] = [`Stability AI 引擎: ${engineId}；可用: stable-diffusion-3.5-large / sd3.5-medium / stable-diffusion-xl-1024-v1-0(SDXL) / stable-image-ultra / stable-image-core`]
    const negativePrompt = (() => { try { if (api.extraBody) return JSON.parse(api.extraBody).negative_prompt } catch { return '' } })()
    const useMasking = isImg2Img && imageUrls.length > 1

    let endpoint: string
    if (useMasking) endpoint = `${baseUrl}/${engineId}/image-to-image/masking`
    else if (isImg2Img) endpoint = `${baseUrl}/${engineId}/image-to-image`
    else endpoint = `${baseUrl}/${engineId}/text-to-image`

    const body: any = {
      text_prompts: [{ text: prompt, weight: 1.0 }],
      width, height,
    }

    if (negativePrompt) {
      body.text_prompts.push({ text: negativePrompt, weight: -1.0 })
    }

    if (isImg2Img) {
      body.init_image = imageUrls[0]
      if (useMasking) body.mask_image = imageUrls[1]
    }

    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.samples !== undefined) body.samples = extra.samples
    if (extra.steps !== undefined) body.steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.cfg_scale !== undefined) body.cfg_scale = extra.cfg_scale
    if (extra.sampler !== undefined) body.sampler = extra.sampler
    if (outputFormat !== 'base64') body.output_format = outputFormat === 'url' ? 'png' : outputFormat

    if (extra.style_preset !== undefined) body.style_preset = extra.style_preset
    if (extra.image_strength !== undefined) body.image_strength = extra.image_strength

    if (outputFormat === 'base64') warnings.push('Stability AI 不支持 base64 输出，已使用 png')
    if (extra.style) warnings.push('Stability AI 使用 style_preset 而非 style')
    if (extra.loras !== undefined || extra.controlnet !== undefined) warnings.push('Stability AI 支持 loras/controlnet，但需根据引擎版本确认')

    return { endpoint, body, warnings, responseImagePath: 'artifacts.0.base64' }
  }

  function buildLeonardoBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://cloud.leonardo.ai/api/rest/v1/generations'
    const warnings: string[] = []
    const body: any = { prompt, modelId: model || '6bef9f1b-29cb-40c7-b9df-32b51c1f67d3', width, height }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}

    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images !== undefined) body.num_images = extra.num_images
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.steps !== undefined) body.steps = extra.steps
    if (extra.guidance_scale !== undefined) body.guidance_scale = extra.guidance_scale
    if (extra.scheduler !== undefined) body.scheduler = extra.scheduler
    if (extra.preset_style !== undefined) body.preset_style = extra.preset_style

    if (imageUrls.length > 0) {
      body.init_image = imageUrls[0]
    }

    warnings.push('Leonardo.ai 模型: Phoenix / Lightning XL / Kino XL / Vision XL / Diffusion XL；不支持 extensions(LoRA/ControlNet)')

    return { endpoint, body, warnings, responseImagePath: 'generations_by_pk.generated_images.0.url' }
  }

  function buildReplicateBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const modelPath = model || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b'
    const endpoint = api.endpoint || `https://api.replicate.com/v1/models/${modelPath}/predictions`
    const warnings: string[] = []
    const body: any = {
      version: modelPath.split(':')[1] || '',
      input: { prompt, width, height },
    }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}

    if (extra.negative_prompt) body.input.negative_prompt = extra.negative_prompt
    if (extra.num_inference_steps !== undefined) body.input.num_inference_steps = extra.num_inference_steps
    if (extra.guidance_scale !== undefined) body.input.guidance_scale = extra.guidance_scale
    if (extra.seed !== undefined) body.input.seed = extra.seed
    if (extra.scheduler !== undefined) body.input.scheduler = extra.scheduler
    if (imageUrls.length > 0) body.input.image = imageUrls[0]

    warnings.push('Replicate 参数因模型而异，请对照模型文档确认字段名；不支持 base64 输出')

    return { endpoint, body, warnings, responseImagePath: 'output.0' }
  }

  async function pollForResult(pollUrl: string, taskId: string, headers: any, timeoutMs: number): Promise<any> {
    const start = Date.now()
    const interval = 2000
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, interval))
      try {
        const res = await axios.get(`${pollUrl}?id=${taskId}`, { headers, timeout: 10000 })
        if (res.data?.status === 'Ready' || res.data?.status === 'succeeded') {
          return res.data
        }
        if (res.data?.status === 'failed' || res.data?.status === 'Task not found') {
          throw new Error(`任务失败: ${JSON.stringify(res.data)}`)
        }
        if (res.data?.result?.sample || res.data?.result?.url || res.data?.output) {
          return res.data
        }
      } catch (e: any) {
        if (e.message?.includes('任务失败')) throw e
      }
    }
    throw new Error('轮询超时：任务未在限定时间内完成')
  }

  function buildFluxBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const modelPath = model || 'flux-2-pro'
    const endpoint = api.endpoint || `https://api.bfl.ai/v1/${modelPath}`
    const warnings: string[] = []
    const body: any = { prompt, width, height }

    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.steps) body.steps = extra.steps
    if (extra.guidance !== undefined) body.guidance = extra.guidance
    if (extra.safety_tolerance !== undefined) body.safety_tolerance = extra.safety_tolerance
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.num_outputs !== undefined) body.num_outputs = extra.num_outputs
    if (imageUrls.length > 0) body.input_image = imageUrls[0]

    warnings.push(`BFL ${modelPath} 为异步 API，插件自动轮询；FLUX.2 系列含 Pro / Dev / Schnell 及 Kontext 等变体`)
    if (extra.negative_prompt) warnings.push('Flux 不原生支持 negative_prompt')

    return { endpoint, body, warnings, responseImagePath: 'result.sample' }
  }

  function buildMidjourneyBody(api: ApiConfig, _model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.midjourney-api.com/v1/imagine'
    const warnings: string[] = []
    const arMap: Record<string, string> = {
      '1024x1024': '--ar 1:1', '1024x1792': '--ar 9:16', '1792x1024': '--ar 16:9',
      '768x1024': '--ar 3:4', '1024x768': '--ar 4:3',
    }
    const arStr = arMap[`${width}x${height}`] || `--ar ${width}:${height}`

    let finalPrompt = `${prompt} ${arStr}`
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.stylize !== undefined) finalPrompt += ` --stylize ${extra.stylize}`
    if (extra.chaos !== undefined) finalPrompt += ` --chaos ${extra.chaos}`
    if (extra.seed !== undefined) finalPrompt += ` --seed ${extra.seed}`
    if (extra.negative_prompt) finalPrompt += ` --no ${extra.negative_prompt}`

    const body: any = { prompt: finalPrompt }
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]

    warnings.push('Midjourney 异步 API（V8/V7/Niji 6），插件自动轮询(约1-3分钟)；参数通过 prompt 内联: --ar/--stylize/--chaos/--seed/--no')

    return { endpoint, body, warnings, responseImagePath: 'result.url' }
  }

  function buildGetimgBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.getimg.ai/v2/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'essential-v2', prompt, width, height }

    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.steps !== undefined) body.steps = extra.steps
    if (extra.guidance !== undefined) body.guidance = extra.guidance
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.num_images !== undefined) body.num_images = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]

    return { endpoint, body, warnings, responseImagePath: 'image.url' }
  }

  function buildIdeogramBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.ideogram.ai/v1/ideogram-v4/generate'
    const warnings: string[] = []
    const arMap: Record<string, string> = {
      '1024x1024': '1:1', '1024x1792': '9:16', '1792x1024': '16:9',
      '768x1024': '3:4', '1024x768': '4:3', '1280x720': '16:9',
    }
    const aspectRatio = arMap[`${width}x${height}`] || '1:1'
    const body: any = { text_prompt: prompt, aspect_ratio: aspectRatio, model: model || 'V_4' }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.style_preset) body.style_preset = extra.style_preset
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.magic_prompt_option) body.magic_prompt_option = extra.magic_prompt_option
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Ideogram 模型: UNI 1.1 Max / Ideogram 4.0(V_4) / Ideogram v3 / Ideogram 2.0')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildVeniceBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.venice.ai/api/v1/image/generate'
    const warnings: string[] = []
    const body: any = { model: model || 'flux-dev', prompt, width, height }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.cfg_scale !== undefined) body.cfg_scale = extra.cfg_scale
    if (extra.steps !== undefined) body.steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.style_preset) body.style_preset = extra.style_preset
    if (extra.num_images !== undefined) body.num_images = extra.num_images
    if (imageUrls.length > 0) body.image_url = imageUrls[0]
    warnings.push('Venice 聚合42+模型，model 可选 flux-dev/flux-pro/sdxl/dalle-3 等')
    return { endpoint, body, warnings, responseImagePath: 'images.0.url' }
  }

  function buildProdiaBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.prodia.com/v1/job'
    const warnings: string[] = []
    const body: any = { model: model || 'sdxl', prompt, width, height }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.steps !== undefined) body.steps = extra.steps
    if (extra.cfg_scale !== undefined) body.cfg_scale = extra.cfg_scale
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.sampler) body.sampler = extra.sampler
    if (extra.num_images !== undefined) body.num_images = extra.num_images
    if (imageUrls.length > 0) body.image_url = imageUrls[0]
    warnings.push('Prodia 为异步 API，插件自动轮询等待结果')
    return { endpoint, body, warnings, responseImagePath: 'imageUrl' }
  }

  function buildDeepAIBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.deepai.org/api/text2image'
    const warnings: string[] = []
    const body = new URLSearchParams()
    body.append('text', prompt)
    if (width && height) body.append('width', String(width))
    if (imageUrls.length > 0) body.append('image', imageUrls[0])
    warnings.push('DeepAI 使用 FormData/URLSearchParams 格式；支持 text2image、image-editor 等端点')
    return { endpoint, body, warnings, responseImagePath: 'output_url', headers: '{"api-key":"{apiKey}"}' }
  }

  function buildRecraftBody(api: ApiConfig, _model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.recraft.ai/v1/images/generations'
    const warnings: string[] = []
    const body: any = { prompt, style: 'digital_illustration', size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.style) body.style = extra.style
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images !== undefined) body.num_images = extra.num_images
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]
    warnings.push('Recraft 模型: V4.1 Utility(最新) / V4 / V3 / 20B / Realistic；style: digital_illustration / realistic_image / vector_illustration')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildImagenBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const isGemini = model?.includes('gemini')
    const geminiModelId = model || 'gemini-3-pro-image-preview'
    const endpoint = api.endpoint || (isGemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${geminiModelId}:generateContent`
      : 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict')
    const warnings: string[] = []
    const sizeKey = `${width}x${height}`

    let body: any
    let responsePath = 'predictions.0.bytesBase64Encoded'

    if (isGemini) {
      const parts: any[] = [{ text: prompt }]
      if (imageUrls.length > 0) {
        parts.push(...imageUrls.map(url => ({ fileData: { fileUri: url, mimeType: 'image/png' } })))
      }
      body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: { aspectRatio: sizeKey === '1024x1792' ? '9:16' : sizeKey === '1792x1024' ? '16:9' : '1:1' },
        },
      }
      responsePath = 'candidates.0.content.parts'
      warnings.push('Gemini Image (Nano Banana) 使用 Gemini API，返回 base64 图片数据')
    } else {
      const validSizes = ['1024x1024', '1024x1792', '1792x1024', '1536x1536', '2048x2048']
      const finalSize = validSizes.includes(sizeKey) ? sizeKey : '1024x1024'
      body = { instances: [{ prompt }], parameters: { sampleCount: 1, imageSize: finalSize } }
      let extra: any = {}
      try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
      if (extra.negative_prompt) body.instances[0].negativePrompt = extra.negative_prompt
      if (extra.num_images) body.parameters.sampleCount = extra.num_images
      if (extra.seed !== undefined) body.parameters.seed = extra.seed
      if (imageUrls.length > 0) warnings.push('Imagen 图生图请使用 Gemini API 图片编辑端点')
    }

    warnings.push('Google 模型需要 API Key，格式可通过 ?key=xxx 查询参数或 x-goog-api-key 请求头')
    return { endpoint, body, warnings, responseImagePath: responsePath }
  }

  function buildXaiBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.x.ai/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'grok-imagine-image-quality', prompt, n: 1, response_format: outputFormat === 'base64' ? 'b64_json' : 'url', size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]
    warnings.push('xAI Grok Imagine(Grok Imagine) 使用 OpenAI 兼容 Images API；模型: grok-imagine-image-quality(推荐/默认) / grok-imagine-image-pro(已弃用)')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildMicrosoftBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.microsoft.com/foundry/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'mai-image-2', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    else body.response_format = 'url'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Microsoft MAI Image(Azure Foundry) OpenAI 兼容；模型: mai-image-2 / mai-image-1 / dall-e-3(托管)')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildFireflyBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://firefly-api.adobe.io/v2/images/generate'
    const warnings: string[] = []
    const body: any = { prompt, n: 1, size: { width, height } }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.style) body.style = extra.style
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]
    warnings.push('Adobe Firefly Image Model 5 需要 OAuth2 认证(client_id+client_secret)；apiKey 格式为 Bearer Token')
    return { endpoint, body, warnings, responseImagePath: 'outputs.0.url' }
  }

  function buildLumaBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.lumalabs.ai/v1/photon/generate'
    const warnings: string[] = []
    const body: any = { model: model || 'photon', prompt, width, height }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.num_images = extra.num_images
    if (extra.seed !== undefined) body.seed = extra.seed
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]
    warnings.push('Luma AI (Dream Machine) Photon 图像模型；端点和参数可能随版本调整')
    return { endpoint, body, warnings, responseImagePath: 'images.0.url' }
  }

  function buildZaiBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://open.bigmodel.cn/api/paas/v4/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'cogview-4', prompt, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Z-AI(智谱) 模型: CogView-4 / Z-Image Turbo / CogView-3-Plus / CogView-3；OpenAI兼容，支持中英文及汉字渲染')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildAmazonBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.titan-image-generator-v2/invoke'
    const warnings: string[] = []
    const body: any = {
      taskType: 'TEXT_IMAGE',
      textToImageParams: { text: prompt },
      imageGenerationConfig: { numberOfImages: 1, width, height, cfgScale: 8 },
    }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.textToImageParams.negativeText = extra.negative_prompt
    if (extra.seed !== undefined) body.imageGenerationConfig.seed = extra.seed
    if (extra.num_images) body.imageGenerationConfig.numberOfImages = extra.num_images
    if (model?.includes('nova')) {
      body.taskType = 'TEXT_IMAGE'
      warnings.push('Amazon Nova Canvas 使用 Bedrock API，请求格式可能与 Titan 略有差异')
    }
    if (imageUrls.length > 0) warnings.push('Amazon 图生图请使用 imageGenerationConfig 中的 initImage 字段')
    warnings.push('⚠️ Amazon Bedrock 需要 AWS SigV4 签名认证，apiKey 需配置为 AWS Access Key；推荐通过 IAM 角色或代理转发')
    return { endpoint, body, warnings, responseImagePath: 'images.0' }
  }

  function buildBaiduBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/text2image/ernie-vilg-v2'
    const warnings: string[] = []
    const body: any = { text: prompt, resolution: `${width}*${height}`, style: 'base', num: 1 }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.style) body.style = extra.style
    if (extra.num) body.num = extra.num
    if (extra.seed !== undefined) body.seed = extra.seed
    if (imageUrls.length > 0) body.url = imageUrls[0]
    warnings.push('百度 ERNIE-Image(文心一格) 异步 API；需 OAuth2 access_token；模型: ERNIE-Image / ERNIE-ViLG v2')
    return { endpoint, body, warnings, responseImagePath: 'data.0.image' }
  }

  function buildAliyunBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'
    const warnings: string[] = []
    const body: any = { model: model || 'qwen-image-2.0-plus', input: { prompt }, parameters: { size: `${width}*${height}`, n: 1 } }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.input.negative_prompt = extra.negative_prompt
    if (extra.seed !== undefined) body.parameters.seed = extra.seed
    if (extra.num_images) body.parameters.n = extra.num_images
    if (imageUrls.length > 0) body.input.ref_image = imageUrls[0]
    warnings.push('阿里通义(Qwen-Image) DashScope API；模型: Qwen-Image-2.0 Max/Pro/Plus / 通义万相 Wan2.7')
    return { endpoint, body, warnings, responseImagePath: 'output.results.0.url' }
  }

  function buildTencentBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://hunyuan.tencentcloudapi.com'
    const warnings: string[] = []
    const body: any = { Prompt: prompt, Resolution: `${width}:${height}`, Style: '201' }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.NegativePrompt = extra.negative_prompt
    if (extra.style) body.Style = extra.style
    if (extra.num) body.Num = extra.num
    if (imageUrls.length > 0) body.InputImage = imageUrls[0]
    warnings.push('腾讯混元(Hunyuan Image 3.0) 需 TC3-HMAC-SHA256 签名；模型: Hunyuan Image 3.0 / 3.0 Plus')
    return { endpoint, body, warnings, responseImagePath: 'ResultImage' }
  }

  function buildSeedreamBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'seedream-5.0-lite', prompt, size: `${width}x${height}`, n: 1 }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('字节即梦(Seedream) 火山引擎 OpenAI 兼容；模型: Seedream 5.0 / Seedream 4.5 / Seedream 4.0')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildHuaweiBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://{pangu-endpoint}.myhuaweicloud.com/v1/{project_id}/pangu/image/generations'
    const warnings: string[] = []
    const body: any = { prompt, resolution: { width, height }, n: 1 }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (imageUrls.length > 0) warnings.push('盘古图生图请联系华为云确认端点')
    warnings.push('华为盘古 PanGu-Draw 需华为云 project_id + IAM 认证；apiKey 为 Token')
    return { endpoint, body, warnings, responseImagePath: 'results.0.url' }
  }

  function buildXfyunBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://spark-api-open.xf-yun.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'general', prompt, width, height }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.num_images = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('科大讯飞星火(Spark) 图像 API；模型: general / spark-image-xl；需讯飞开放平台 APPID+APIKey')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildSenseBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.sensenova.cn/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'miaohua-v3', prompt, size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('商汤秒画(Miaohua) SenseNova API；模型: miaohua-v3')
    return { endpoint, body, warnings, responseImagePath: 'images.0.url' }
  }

  function buildMeituBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.meitu.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'miracle-vision-v4', prompt, size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.reference_image = imageUrls[0]
    warnings.push('美图(MiracleVision) 图像 API；模型: miracle-vision-v4 / v3')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildMinimaxBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.minimax.chat/v1/image/generation'
    const warnings: string[] = []
    const body: any = { model: model || 'image-01', prompt, image_size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.n) body.n = extra.n
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('MiniMax Hailuo(海螺) 系列 图像 API；模型: image-01 / hailuo')
    return { endpoint, body, warnings, responseImagePath: 'data.image_url' }
  }

  function buildKuaishouBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.klingai.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'kling-1.6', prompt, size: `${width}x${height}`, n: 1 }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('快手可灵(Kling) 图像 API；模型: Kling 1.6 / 1.5 / Kolors；支持图生图')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildStepfunBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.stepfun.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'step-1x', prompt, size: `${width}x${height}` }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (extra.seed !== undefined) body.seed = extra.seed
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('阶跃星辰 Step-1X 系列 图像 API；模型: step-1x / step-2')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildOpenrouterBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://openrouter.ai/api/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'gpt-image-2', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('OpenRouter 聚合300+模型；OpenAI 兼容；model 可选 gpt-image-2/gemini-3-pro-image/flux/dev 等')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildTogetherBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.together.xyz/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'black-forest-labs/FLUX.2-dev', prompt, n: 1, width, height }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.steps) body.steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image_url = imageUrls[0]
    warnings.push('Together AI 聚合多模型；OpenAI 兼容；支持 FLUX/SD/SDXL 等开源模型')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildFalBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const modelPath = model || 'fal-ai/flux/dev'
    const endpoint = api.endpoint || `https://fal.run/${modelPath}`
    const warnings: string[] = []
    const body: any = { prompt, image_size: { width, height } }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.steps) body.num_inference_steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.guidance_scale !== undefined) body.guidance_scale = extra.guidance_scale
    if (imageUrls.length > 0) body.image_url = imageUrls[0]
    warnings.push('fal.ai 聚合平台，独家访问 ByteDance/Alibaba 等模型；路径格式: fal-ai/flux/dev / stabilityai/sdxl 等')
    return { endpoint, body, warnings, responseImagePath: 'images.0.url' }
  }

  function buildSegmindBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], _outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.segmind.com/v1/txt2img'
    const warnings: string[] = []
    const body: any = { model: model || 'sdxl', prompt, width, height, samples: 1 }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.steps) body.steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (extra.samples) body.samples = extra.samples
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Segmind 聚合平台；支持 SD/SDXL/Flux 等多模型')
    return { endpoint, body, warnings, responseImagePath: 'image' }
  }

  function buildDeepinfraBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-dev'
    const warnings: string[] = []
    const body: any = { input: { prompt, width, height } }
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.input.negative_prompt = extra.negative_prompt
    if (extra.steps) body.input.num_inference_steps = extra.steps
    if (extra.seed !== undefined) body.input.seed = extra.seed
    if (imageUrls.length > 0) body.input.image = imageUrls[0]
    if (outputFormat === 'base64') warnings.push('DeepInfra 默认返回 URL')
    warnings.push('DeepInfra 聚合开源模型；支持 FLUX/SD/SDXL 等；默认模型 FLUX.2-dev')
    return { endpoint, body, warnings, responseImagePath: 'output.url' }
  }

  function buildAtlasBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.atlascloud.ai/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'flux/dev', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Atlas Cloud 聚合600+模型(Kling/Wan/Flux/Seedream等)；OpenAI 兼容；图像+视频+语音统一API')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildCometBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.cometapi.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'flux/dev', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('CometAPI 聚合500+模型(GPT/Midjourney/Flux/Gemini等)；OpenAI 兼容；按模型精准定价路由')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildWavespeedBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.wavespeed.ai/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'flux/dev', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('WaveSpeedAI 聚合平台；OpenAI 兼容；统一平台主打更优惠价格')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildQiniuBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://ai.qiniu.com/api/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'stable-diffusion', prompt, n: 1, size: `${width}x${height}` }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('七牛云 AI 聚合平台，覆盖开源+闭源多种模型；OpenAI 兼容')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildFreepikBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.freepik.com/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'magnific', prompt, width, height, n: 1 }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.num_images) body.n = extra.num_images
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Freepik Magnific API 图像生成+编辑；支持 AI 资源搜索与生成')
    return { endpoint, body, warnings, responseImagePath: 'data.0.url' }
  }

  function buildKreaBody(api: ApiConfig, model: string, prompt: string, sizeStr: string, imageUrls: string[], outputFormat: string): BackendResult {
    const { width, height } = parseSize(sizeStr)
    const endpoint = api.endpoint || 'https://api.krea.ai/v1/images/generations'
    const warnings: string[] = []
    const body: any = { model: model || 'flux', prompt, width, height }
    if (outputFormat === 'base64') body.response_format = 'b64_json'
    let extra: any = {}
    try { if (api.extraBody) extra = JSON.parse(api.extraBody) } catch {}
    if (extra.negative_prompt) body.negative_prompt = extra.negative_prompt
    if (extra.steps) body.steps = extra.steps
    if (extra.seed !== undefined) body.seed = extra.seed
    if (imageUrls.length > 0) body.image = imageUrls[0]
    warnings.push('Krea AI 40+模型聚合；Flux/Imagen4/Ideogram3 等；支持图像/视频生成+编辑')
    return { endpoint, body, warnings, responseImagePath: 'images.0.url' }
  }

  function isBuiltinBackend(api: ApiConfig): boolean {
    return !!api.backend && api.backend !== 'custom'
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

    if (isBuiltinBackend(api)) {
      const outputFormat = 'url'
      const converters: Record<string, (a: ApiConfig, m: string, p: string, s: string, imgs: string[], fmt: string) => BackendResult> = {
        agnes: buildAgnesBody,
        openai: buildOpenAIBody,
        stability: buildStabilityBody,
        leonardo: buildLeonardoBody,
        replicate: buildReplicateBody,
        flux: buildFluxBody,
        midjourney: buildMidjourneyBody,
        getimg: buildGetimgBody,
        ideogram: buildIdeogramBody,
        venice: buildVeniceBody,
        prodia: buildProdiaBody,
        deepai: buildDeepAIBody,
        recraft: buildRecraftBody,
        imagen: buildImagenBody,
        xai: buildXaiBody,
        microsoft: buildMicrosoftBody,
        firefly: buildFireflyBody,
        luma: buildLumaBody,
        zai: buildZaiBody,
        amazon: buildAmazonBody,
        baidu: buildBaiduBody,
        aliyun: buildAliyunBody,
        tencent: buildTencentBody,
        seedream: buildSeedreamBody,
        huawei: buildHuaweiBody,
        xfyun: buildXfyunBody,
        sense: buildSenseBody,
        meitu: buildMeituBody,
        minimax: buildMinimaxBody,
        kuaishou: buildKuaishouBody,
        stepfun: buildStepfunBody,
        openrouter: buildOpenrouterBody,
        together: buildTogetherBody,
        fal: buildFalBody,
        segmind: buildSegmindBody,
        deepinfra: buildDeepinfraBody,
        atlas: buildAtlasBody,
        comet: buildCometBody,
        wavespeed: buildWavespeedBody,
        qiniu: buildQiniuBody,
        freepik: buildFreepikBody,
        krea: buildKreaBody,
      }
      const converter = converters[api.backend]
      if (!converter) {
        logger.error('不支持的后端类型:', api.backend)
        await safeSend(session, cfg.messages.fail + '（不支持的后端类型）')
        return
      }

      let result: BackendResult
      try {
        result = converter(api, model, prompt, size, imageUrls, outputFormat)
      } catch (e) {
        logger.error('后端转换器执行失败', e)
        await safeSend(session, cfg.messages.fail + '（后端转换失败）')
        return
      }

      if (debug) {
        if (result.warnings.length > 0) logger.info(`[${api.backend}] 警告:`, result.warnings.join('; '))
        logger.info(`[${api.backend}] 请求:`, result.endpoint, JSON.stringify(result.body, null, 2))
      }

      if (!validateEndpointUrl(result.endpoint)) {
        logger.error('无效的API端点URL:', result.endpoint)
        await safeSend(session, cfg.messages.fail + '（API端点配置无效）')
        return
      }

      const resultHeaders = result.headers || api.headers || '{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}'
      const headersVars: Record<string, any> = { apiKey: api.apiKey }
      let headers: any
      try {
        headers = resolveTemplate(resultHeaders, headersVars)
      } catch {
        headers = { Authorization: `Bearer ${api.apiKey}`, 'Content-Type': 'application/json' }
      }

      const responsePath = result.responseImagePath || api.responseImagePath
      const isAsyncBackend = api.backend === 'flux' || api.backend === 'midjourney' || api.backend === 'prodia'

      try {
        const postRes = await axios.post(result.endpoint, result.body, { headers, timeout: cfg.timeout })
        if (debug) logger.info(`[${api.backend}] 提交响应:`, JSON.stringify(postRes.data, null, 2))

        let finalData = postRes.data

        if (isAsyncBackend) {
          const taskId = postRes.data?.id || postRes.data?.taskId
          if (!taskId) {
            await safeSend(session, cfg.messages.fail + '（未获取到异步任务ID）')
            return
          }
          const pollUrl = api.backend === 'midjourney'
            ? (result.endpoint.replace('/imagine', '/fetch'))
            : 'https://api.bfl.ai/v1/get_result'
          if (debug) logger.info(`[${api.backend}] 开始轮询任务: ${taskId}`)
          finalData = await pollForResult(pollUrl, taskId, headers, cfg.timeout)
          if (debug) logger.info(`[${api.backend}] 轮询完成:`, JSON.stringify(finalData, null, 2))
        }

        const imgUrl = extractImageUrl(finalData, responsePath)
        await handleImageResponse(session, imgUrl, finalData)
      } catch (err) {
        const reason = getErrorMessage(err)
        logger.error(`[${api.backend}] API请求失败 [${reason}]`, err)
        await safeSend(session, `${cfg.messages.fail} [${reason}]`)
      } finally {
        if (imageUrls.length > 0) deleteAllCachedFiles(imageUrls)
      }
      return
    }

    const endpointTemplate = api.endpoint || api.baseUrl
    const headersTemplate = api.headers || '{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}'
    const bodyTemplate = imageUrls.length > 0 ? api.img2imgBody : api.txt2imgBody
    const endpoint = endpointTemplate.replace(/\{model\}/g, model)
    const headersVars2: Record<string, any> = { apiKey: api.apiKey }
    const headers = resolveTemplate(headersTemplate, headersVars2)
    const bodyVars: Record<string, any> = { model, prompt, size }
    if (imageUrls.length > 0) bodyVars['__arr_image_urls'] = imageUrls

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
      const res = await axios.post(endpoint, body, { headers, timeout: cfg.timeout })
      if (debug) logger.info('自定义响应:', JSON.stringify(res.data, null, 2))
      const imgUrl = extractImageUrl(res.data, api.responseImagePath)
      await handleImageResponse(session, imgUrl, res.data)
    } catch (err) {
      const reason = getErrorMessage(err)
      logger.error(`自定义API请求失败 [${reason}]`, err)
      await safeSend(session, `${cfg.messages.fail} [${reason}]`)
    } finally {
      if (imageUrls.length > 0) deleteAllCachedFiles(imageUrls)
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