# koishi-plugin-ai-image

## 项目介绍 (Project Introduction)

### 中文
这是一款为 Koishi 聊天机器人框架开发的 AI 绘图插件，支持文生图、图生图，**仅兼容 OpenAI 标准接口**，内置 API 负载均衡、调试日志、自定义绘画提示词，图生图支持独立指令、超时等待、可配置提示文案，配置简单、开箱即用。

### English
This is an AI drawing plugin developed for the Koishi chatbot framework. It supports text-to-image and image-to-image, **only compatible with OpenAI standard API**. Built-in API load balancing, debug logs, custom painting prompts, image-to-image supports independent commands, timeout waiting, configurable prompt texts. Easy to configure and ready to use.

## 使用说明 (Usage)

### 中文
| 命令 (Command) | 功能说明 (Description) |
| --- | --- |
| `draw 提示词` | 文生图，输入绘画提示词直接生成图片 |
| `imgdraw 提示词` | 图生图，发送指令后在限定时间内上传参考图即可生成 |

### English
| Command | Description |
| --- | --- |
| `draw prompt` | Text-to-image, generate image directly with prompt |
| `imgdraw prompt` | Image-to-image, upload reference image within time limit after command |

## 配置说明 (Configuration)

### 中文
| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| **🔧 基础配置** | | |
| `debug` | 开启调试模式，输出完整请求、返回及错误日志 | false |
| `apiStrategy` | API 调度策略：顺序模式 / 负载均衡模式 | roundrobin |
| `timeout` | 接口请求超时时间（毫秒） | 300000 |
| `rateLimit` | 每小时接口调用次数限制 | 200 |
| `imgWaitTime` | 图生图等待图片超时时间（秒） | 60 |
| **📝 模型与提示词配置** | | |
| `model` | 模型名称，手动填写 | 空 |
| `autoPrompt` | 自动追加正向绘画修饰词 | true |
| `positive` | 自动追加的正向画质修饰词 | masterpiece, best quality |
| **🔗 API 列表配置** | | |
| `apiList` | API 配置列表，支持多轮询负载均衡 | [] |
| `apiList[].enable` | 是否启用当前这条 API | true |
| `apiList[].apiKey` | 接口密钥 | 空 |
| `apiList[].baseUrl` | 接口地址，仅支持 OpenAI 标准路径 | 空 |
| **💬 指令配置** | | |
| `command` | 文生图主指令 | draw |
| `aliases` | 文生图指令别名 | [] |
| `img2imgCommand` | 图生图主指令 | imgdraw |
| `img2imgAliases` | 图生图指令别名 | [] |
| **⚙️ 功能开关** | | |
| `enableTxt2Img` | 启用文生图 | true |
| `enableImg2Img` | 启用图生图 | true |
| **💬 提示文案配置** | | |
| `messages.generating` | 生成中提示 | ⏳ 生成中... |
| `messages.waitImage` | 等待图片提示 | 请在60秒内发送需要编辑的图片 |
| `messages.timeout` | 超时提示 | 等待图片超时，已取消 |

### English
| Config Item | Description | Default |
| --- | --- | --- |
| **🔧 Basic Configuration** | | |
| `debug` | Enable debug mode, output full request, response and error logs | false |
| `apiStrategy` | API scheduling strategy: sequence / roundrobin | roundrobin |
| `timeout` | API request timeout (ms) | 300000 |
| `rateLimit` | Hourly request limit | 200 |
| `imgWaitTime` | Image-to-image wait timeout (seconds) | 60 |
| **📝 Model & Prompt** | | |
| `model` | Model name | Empty |
| `autoPrompt` | Auto append positive prompt | true |
| `positive` | Positive quality modifier | masterpiece, best quality |
| **🔗 API List** | | |
| `apiList` | API list, support load balancing | [] |
| `apiList[].enable` | Enable this API | true |
| `apiList[].apiKey` | API Key | Empty |
| `apiList[].baseUrl` | API endpoint (OpenAI only) | Empty |
| **💬 Command** | | |
| `command` | Text-to-image command | draw |
| `aliases` | Text-to-image aliases | [] |
| `img2imgCommand` | Image-to-image command | imgdraw |
| `img2imgAliases` | Image-to-image aliases | [] |
| **⚙️ Feature Toggle** | | |
| `enableTxt2Img` | Enable text-to-image | true |
| `enableImg2Img` | Enable image-to-image | true |
| **💬 Messages** | | |
| `messages.generating` | Generating tip | ⏳ Generating... |
| `messages.waitImage` | Waiting image tip | Please send image within 60 seconds |
| `messages.timeout` | Timeout tip | Waiting image timeout, canceled |

## 兼容接口 (Supported API)
仅支持 OpenAI 标准接口：
- `/v1/chat/completions`

## 项目贡献者 (Contributors)
| 贡献者 | 贡献内容 |
| --- | --- |
| Minecraft-1314 | 插件完整开发 |
| （欢迎提交 PR） | |

## 许可协议 (License)
MIT License

## 支持我们 (Support Us)
点亮 Star ⭐ 支持项目持续更新！