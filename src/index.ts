import { Schema, Logger, segment, Context, h } from 'koishi'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import yaml from 'yaml'

export const name = 'ai-image'
export const inject = ['console']

const logger = new Logger('ai-image')

type Infer<T> = T extends Schema<infer U> ? U : never

export const Config = Schema.object({
  debug: Schema.boolean().default(false).description('开启调试模式（输出详细日志）'),
  apiStrategy: Schema.union([
    Schema.const('sequence').description('顺序模式'),
    Schema.const('roundrobin').description('负载均衡模式')
  ]).default('roundrobin').description('API调用模式'),
  timeout: Schema.number().default(300000).min(0).step(1).description('请求超时时间(ms)'),
  rateLimit: Schema.number().default(200).min(0).step(1).description('每小时调用限制'),
  imgWaitTime: Schema.number().default(60).min(0).description('图生图等待图片超时时间（秒）'),
  apiList: Schema.array(Schema.object({
    enable: Schema.boolean().default(true).description('启用'),
    apiKey: Schema.string().default('').description('API Key'),
    baseUrl: Schema.string().default('').description('接口地址'),
  })).default([]).description('API 配置列表'),
  model: Schema.string().default('dall-e-3').description('模型名称'),
  autoPrompt: Schema.boolean().default(true).description('自动追加提示词'),
  positive: Schema.string().default('masterpiece, best quality').description('正向提示词'),
  command: Schema.string().default('draw').description('文生图指令'),
  aliases: Schema.array(Schema.string()).default([]).description('文生图指令别名'),
  img2imgCommand: Schema.string().default('imgdraw').description('图生图指令'),
  img2imgAliases: Schema.array(Schema.string()).default([]).description('图生图指令别名'),
  messages: Schema.object({
    empty: Schema.string().default('❌ 请输入提示词').description('无提示词提示'),
    generating: Schema.string().default('⏳ 生成中...').description('生成中提示'),
    noApi: Schema.string().default('❌ 未配置可用API').description('无API提示'),
    noImg: Schema.string().default('❌ 生成失败').description('无图片提示'),
    success: Schema.string().default('✅ 生成成功').description('生成成功提示'),
    fail: Schema.string().default('❌ 生成失败').description('生成失败提示'),
    waitImage: Schema.string().default('请在60秒内发送需要编辑的图片').description('等待图片提示'),
    timeout: Schema.string().default('等待图片超时，已取消').description('超时提示'),
  }).description('提示文本配置'),
  enableTxt2Img: Schema.boolean().default(true).description('启用文生图'),
  enableImg2Img: Schema.boolean().default(true).description('启用图生图'),
})

export async function apply(ctx: Context, cfg: Infer<typeof Config>) {
  const debug = cfg.debug
  try {
    const loc = path.resolve(__dirname, '../locales/zh-CN.yml')
    if (fs.existsSync(loc)) {
      ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
    }
  } catch (e) {}

  const idx = { val: 0 }
  const waitingMap = new Map<string, { prompt: string; timer: NodeJS.Timeout }>()

  function getApi() {
    const list = cfg.apiList.filter((v) => v.enable && v.apiKey && v.baseUrl)
    if (!list.length) return null
    if (cfg.apiStrategy === 'sequence') return list[0]
    const i = idx.val % list.length
    idx.val++
    const selected = list[i]
    if (debug) logger.info('[DEBUG] 选中API:', selected.baseUrl)
    return selected
  }

  function cleanHtmlTags(str: string) {
    return str.replace(/<[^>]+>/g, '').trim()
  }

  function getImageUrlFromContent(text: string) {
    const reg = /https?:\/\/[^<> \n\r()\[\]]+\.(png|jpg|jpeg|gif|webp)/i
    const match = text.match(reg)
    return match ? match[0] : null
  }

  async function urlToBase64(url: string): Promise<string> {
    const res = await axios.get(url, { responseType: 'arraybuffer' })
    const base64 = Buffer.from(res.data, 'binary').toString('base64')
    return `data:image/jpeg;base64,${base64}`
  }

  async function generateImage(session: any, prompt: string, base64Img = '') {
    const api = getApi()
    if (!api) {
      if (debug) logger.info('[DEBUG] 无可用API')
      return
    }

    const promptFinal = cfg.autoPrompt ? `${prompt}, ${cfg.positive}` : prompt

    const body: any = {
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: base64Img
            ? [
                { type: 'text', text: promptFinal },
                { type: 'image_url', image_url: { url: base64Img } }
              ]
            : promptFinal
        }
      ]
    }

    if (debug) logger.info('[DEBUG] 请求体:', JSON.stringify(body, null, 2))

    try {
      const res = await axios.post(api.baseUrl, body, {
        headers: { Authorization: `Bearer ${api.apiKey}` },
        timeout: cfg.timeout
      })

      if (debug) logger.info('[DEBUG] API返回:', JSON.stringify(res.data, null, 2))
      let imgUrl = res.data?.data?.[0]?.url || null
      if (!imgUrl) imgUrl = getImageUrlFromContent(res.data?.choices?.[0]?.message?.content || '')

      if (!imgUrl) {
        if (debug) logger.info('[DEBUG] 未获取到图片链接')
        return
      }

      await session.send(segment.image(imgUrl))
    } catch (err) {
      if (debug) logger.error('[DEBUG] 请求失败', err)
    }
  }

  const cmd = ctx.command(`${cfg.command} <raw:text>`)
  cfg.aliases.forEach(alias => cmd.alias(alias))
  cmd.action(async ({ session }, raw) => {
    if (!session || !cfg.enableTxt2Img) return
    const prompt = cleanHtmlTags(raw || '')
    if (!prompt) return
    await session.send(cfg.messages.generating)
    await generateImage(session, prompt)
  })

  const imgCmd = ctx.command(`${cfg.img2imgCommand} <raw:text>`)
  cfg.img2imgAliases.forEach(alias => imgCmd.alias(alias))
  imgCmd.action(async ({ session }, raw) => {
    if (!session || !cfg.enableImg2Img) return
    const prompt = cleanHtmlTags(raw || '')
    if (!prompt) return

    const key = `${session.guildId || 'private'}-${session.userId}`
    if (waitingMap.has(key)) return

    const text = cfg.messages.waitImage.replace('60', String(cfg.imgWaitTime))
    session.send(text)

    const timer = setTimeout(() => {
      waitingMap.delete(key)
      session.send(cfg.messages.timeout)
    }, cfg.imgWaitTime * 1000)

    waitingMap.set(key, { prompt, timer })
  })

  ctx.on('message', async (session) => {
    if (!session.elements) return
    const key = `${session.guildId || 'private'}-${session.userId}`
    const task = waitingMap.get(key)
    if (!task) return

    const imgEl = h.select(session.elements, 'img')[0]
    if (!imgEl) return

    const src = imgEl.attrs.src as string
    if (!src) return

    clearTimeout(task.timer)
    waitingMap.delete(key)
    
    await session.send(cfg.messages.generating)

    try {
      const base64 = await urlToBase64(src)
      await generateImage(session, task.prompt, base64)
    } catch (e) {
      if (debug) logger.error('[DEBUG] 图片转换失败', e)
    }
  })
}