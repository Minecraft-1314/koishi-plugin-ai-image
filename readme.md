# koishi-plugin-ai-image

## 项目介绍 (Project Introduction)

### 中文
一款为 Koishi 聊天机器人框架开发的 AI 绘图插件，支持**文生图 + 图生图**，**严格兼容 OpenAI 标准接口**。  
内置多 API 负载均衡、详细调试日志、超时等待机制、全配置化提示文案，配置简单、开箱即用、稳定可靠。

### English
An AI image generation plugin for the Koishi chatbot framework, supporting **text-to-image & image-to-image**.  
Strictly compatible with OpenAI‑standard APIs. Built‑in multi‑API load balancing, debug logging, timeout mechanism, and fully configurable messages. Easy setup, ready to use, stable and reliable.

## 使用说明 (Usage)

| 命令 (Command)   | 功能说明 (Description) |
|------------------|------------------------|
| `draw <提示词>`   | 文生图：根据提示词直接生成图片 |
| `imgdraw <提示词>` | 图生图：发送指令后在限定时间内上传参考图，基于参考图生成新图 |

| Command          | Description |
|------------------|-------------|
| `draw <prompt>`   | Text-to-image: Generate an image from the prompt |
| `imgdraw <prompt>` | Image-to-image: Send the command, then upload a reference image within the time limit to generate a variation |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **🔧 基础设置** | | |
| `debug` | 调试模式（输出完整请求体/响应/错误日志） | `false` |
| `apiStrategy` | API 调度策略：`sequence`（顺序）/ `roundrobin`（负载均衡） | `roundrobin` |
| `timeout` | API 请求超时时间（毫秒） | `300000` |
| `rateLimit` | 每小时调用频率限制 | `200` |
| `imgWaitTime` | 图生图等待用户发送图片的超时时间（秒） | `60` |
| **📝 模型** | | |
| `model` | 使用的模型名称 | `gpt-4o-mini` |
| **🔗 API 列表** | | |
| `apiList` | API 配置数组，可用于多账号轮询 | `[]` |
| `apiList[].enable` | 是否启用该 API 配置 | `true` |
| `apiList[].apiKey` | API 密钥 | (空) |
| `apiList[].baseUrl` | 接口地址（必须符合 OpenAI 标准） | (空) |
| **💬 指令** | | |
| `enableTxt2Img` | 启用文生图功能 | `true` |
| `command` | 文生图指令 | `draw` |
| `aliases` | 文生图指令别名 | `[]` |
| `enableImg2Img` | 启用图生图功能 | `true` |
| `img2imgCommand` | 图生图指令 | `imgdraw` |
| `img2imgAliases` | 图生图指令别名 | `[]` |
| **💬 提示文案** | | |
| `messages.generating` | 正在生成图片的提示 | `⏳ 生成中...` |
| `messages.waitImage` | 等待用户发送图片的提示 | `请在60秒内发送需要编辑的图片` |
| `messages.timeout` | 等待超时的提示 | `等待图片超时，已取消` |
| `messages.empty` | 未输入提示词 | `❌ 请输入提示词` |
| `messages.noApi` | 没有可用的 API 配置 | `❌ 未配置可用API` |
| `messages.noImg` | 模型未返回图片 | `❌ 生成失败` |
| `messages.success` | 生成成功 | `✅ 生成成功` |
| `messages.fail` | 生成失败 | `❌ 生成失败` |
| `messages.needAssets` | 图生图未安装 assets 服务时的提示 | `❌ 图生图需要安装并启用 assets-local 服务` |

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| **🔧 Basic** | | |
| `debug` | Enable debug logging (full request/response/error output) | `false` |
| `apiStrategy` | API strategy: `sequence` / `roundrobin` | `roundrobin` |
| `timeout` | API request timeout in milliseconds | `300000` |
| `rateLimit` | Hourly rate limit | `200` |
| `imgWaitTime` | Time (seconds) to wait for user to send an image in img2img mode | `60` |
| **📝 Model** | | |
| `model` | Model name | `gpt-4o-mini` |
| **🔗 API List** | | |
| `apiList` | Array of API configurations for load balancing | `[]` |
| `apiList[].enable` | Enable this API entry | `true` |
| `apiList[].apiKey` | API key | (empty) |
| `apiList[].baseUrl` | API endpoint (OpenAI format required) | (empty) |
| **💬 Commands** | | |
| `enableTxt2Img` | Enable text-to-image | `true` |
| `command` | Text-to-image command | `draw` |
| `aliases` | Text-to-image aliases | `[]` |
| `enableImg2Img` | Enable image-to-image | `true` |
| `img2imgCommand` | Image-to-image command | `imgdraw` |
| `img2imgAliases` | Image-to-image aliases | `[]` |
| **💬 Messages** | | |
| `messages.generating` | Shown while generating | `⏳ Generating...` |
| `messages.waitImage` | Prompt to send an image | `Please send image within 60s` |
| `messages.timeout` | Timeout message | `Image wait timeout, canceled` |
| `messages.empty` | Empty prompt | `❌ Please enter a prompt` |
| `messages.noApi` | No API available | `❌ No available API` |
| `messages.noImg` | No image returned | `❌ Generation failed` |
| `messages.success` | Success message | `✅ Generation successful` |
| `messages.fail` | Failure message | `❌ Generation failed` |
| `messages.needAssets` | Missing assets service notice | `❌ Image-to-image requires the assets-local service` |

## 依赖 (Dependencies)
- 图生图功能需要安装并启用 `@koishijs/plugin-assets-local`（或其他 `assets` 服务插件）

## 兼容接口 (Supported API)
仅支持 **OpenAI 标准接口**  
- `/v1/chat/completions`

## 功能特性
- 完整的文生图 / 图生图功能，指令独立
- 多 API 密钥轮询与负载均衡（顺序 / 轮询策略）
- 图生图自动等待用户上传图片，超时自动取消
- 全配置化提示文案，无需修改代码
- 详细的调试日志，便于排查问题
- 开箱即用，配置极简

## 项目贡献者 (Contributors)

| 贡献者 | 贡献内容 |
|--------|----------|
| Minecraft-1314 | 插件完整开发 |
| 欢迎提交 PR / Issue | 共同完善项目 |

## 许可协议 (License)
MIT License

## 支持我们 (Support Us)
如果你喜欢本插件，欢迎点亮 **Star ⭐** 支持项目持续更新！