# koishi-plugin-ai-image

## 项目介绍 (Project Introduction)

### 中文
一款为 Koishi 聊天机器人框架开发的 AI 绘图插件，支持**文生图 + 图生图**，**兼容 OpenAI 标准接口的同时支持自定义 API 端点**，可接入任意图像生成服务。  
内置多 API 负载均衡、调试日志、超时等待机制、全配置化提示文案（含自定义提示模板），配置灵活、开箱即用、稳定可靠。  
图生图支持同时发送**多张参考图片**，并可自定义最大图片数量。  
提供**黑名单管理**功能，数据持久化到数据库，管理员可通过指令添加、移除用户及查看黑名单。  

### English
An AI image generation plugin for the Koishi chatbot framework, supporting **text-to-image & image-to-image**.  
Compatible with OpenAI‑standard APIs, and also supports **custom API endpoints** for any image generation service.  
Built‑in multi‑API load balancing, debug logging, timeout mechanism, fully configurable messages and prompt templates.  
Image‑to‑image supports **multiple reference images** with configurable maximum count.  
**Blacklist management** with database persistence.  

## 使用说明 (Usage)

### 中文

| 命令 (Command)                     | 功能说明 (Description) |
|------------------------------------|------------------------|
| `draw <提示词>`                  | 文生图：根据提示词直接生成图片 |
| `imgdraw <提示词>`               | 图生图：发送指令后在限定时间内上传参考图（可发送多张），输入“完成”或“done”开始生成，输入“取消”或“cancel”放弃等待；支持直接在指令后附带图片链接，一键生成 |
| `redraw` / `rd` / `重绘`         | 重绘：重新生成上一次的文生图结果 |
| `blacklist list`                 | 查看当前黑名单（仅管理员） |
| `blacklist add <QQ号> [QQ号 ...]`  | 将指定 QQ 号加入黑名单（仅管理员） |
| `blacklist remove <QQ号> [QQ号 ...]` | 将指定 QQ 号移出黑名单（仅管理员） |

### English

| Command                             | Description |
|-------------------------------------|-------------|
| `draw <prompt>`                   | Text-to-image: Generate an image from the prompt |
| `imgdraw <prompt>`                | Image-to-image: Send the command, then upload one or more reference images within the time limit. Send "done" or "完成" to start generation, send "cancel" or "取消" to abort |
| `redraw` / `rd` / `重绘`         | Redraw: Re-generate the last text-to-image result |
| `blacklist list`                  | Show current blacklist (admin only) |
| `blacklist add <QQ_number> [QQ_number ...]` | Add QQ number(s) to blacklist (admin only) |
| `blacklist remove <QQ_number> [QQ_number ...]` | Remove QQ number(s) from blacklist (admin only) |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **基本设置** | | |
| `debug` | 调试模式，输出完整请求/响应日志 | `false` |
| `apiStrategy` | API 调度策略：`sequence`（顺序）/ `roundrobin`（轮询负载均衡） | `roundrobin` |
| `timeout` | API 请求超时时间（毫秒） | `300000` |
| `rateLimit` | 每小时调用次数上限 | `200` |
| `imgWaitTime` | 图生图等待用户上传图片的超时秒数 | `60` |
| `model` | 通用模型名称，文生图/图生图共用 | `gpt-image-2` |
| `txt2imgModel` | 文生图专用模型，留空则使用通用模型 | (空) |
| `img2imgModel` | 图生图专用模型，留空则使用通用模型 | (空) |
| `imageSize` | 默认图片尺寸（宽x高） | `1024x1024` |
| `maxImages` | 图生图最大支持图片数量 | `5` |
| `imageSendMode` | 图片发送方式：`image`（仅图片）、`url`（仅链接）、`both`（图片+链接） | `image` |
| `enableForward` | 多图结果是否使用合并转发 | `true` |
| `enableTxt2Img` | 启用文生图功能 | `true` |
| `enableImg2Img` | 启用图生图功能 | `true` |
| `responseImageFormat` | 图片数据格式：`url`（直链）、`pure_base64`（纯 Base64）、`data_uri`（Data URI） | `url` |
| **API 配置** | 每个条目是一个完整的请求范式 JSON | `[]` |
| `apiList[].enable` | 是否启用此 API | `true` |
| `apiList[].example` | **（大文本框）** 请求范式 JSON，详见下方说明 | 见默认示例 |
| **指令设置** | | |
| `command` | 文生图触发指令 | `draw` |
| `aliases` | 文生图指令别名 | `[]` |
| `img2imgCommand` | 图生图触发指令 | `imgdraw` |
| `img2imgAliases` | 图生图指令别名 | `[]` |
| `redrawCommand` | 重绘触发指令 | `redraw` |
| `redrawAliases` | 重绘指令别名 | `['rd', '重绘']` |
| **提示词模板** | | |
| `txt2imgPrompt` | 文生图提示模板，变量 `{prompt}` | 见默认 |
| `img2imgPrompt` | 图生图提示模板，变量 `{url}` `{prompt}` | 见默认 |
| **权限管理** | | |
| `blacklistAdmins` | 黑名单管理员 QQ 号列表 | `[]` |
| **消息文本** | 所有提示文案均可自定义，支持模板变量 | 见配置页 |

#### 请求范式 JSON (`example` 字段)

这是一个 **完整的 JSON 对象**，插件会解析它来构造实际请求。支持以下字段（除 `endpoint` 外均为可选）：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `endpoint` | **必填**，API 端点 URL，支持变量 `{model}` | - |
| `apiKey` | API 密钥，如果省略则不从配置读取 | - |
| `headers` | 请求头 JSON 对象，支持变量 `{apiKey}` | `{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}` |
| `txt2imgBody` | 文生图请求体 JSON 模板，支持变量 `{model}` `{prompt}` `{size}` | `{"model":"{model}","prompt":"{prompt}","size":"{size}"}` |
| `img2imgBody` | 图生图请求体 JSON 模板，支持变量 `{model}` `{prompt}` `{size}` `{{image_urls}}` `{{image_objects}}` | 见默认 |
| `responseImagePath` | 响应 JSON 中图片数据的字段路径，如 `data.0.url` 或 `data.0.b64_json` | `data.0.url` |
| `responseImageFormat` | 图片格式：`url`（HTTP链接）、`pure_base64`（纯Base64）、`data_uri`（data:image/png;base64,...） | `url` |
| `adapterType` | 接口类型：`chat`（OpenAI 消息格式，默认）/ `flat`（原生绘图扁平格式） | `chat` |
| `extraBody` | 额外 JSON 字段，会深度合并到请求体中 | 空 |
| `method` | HTTP 方法，默认 POST | `POST` |

**变量说明**  
- `{model}`：模型名称（取自配置中的全局模型或专用模型）  
- `{prompt}`：用户输入的提示词（经过提示模板处理后的最终文本）  
- `{size}`：图片尺寸（取自配置的 `imageSize`）  
- `{{image_urls}}`：图生图时生成 **图片 URL 数组**（JSON 数组），适用于大多数 DALL-E 风格 API  
- `{{image_objects}}`：图生图时生成 **Chat Completions 风格图片对象列表**，适用于 OpenAI Chat API  
- `{url}`：图生图时第一张图片的链接（字符串）  
- `{apiKey}`：API 密钥，仅用于 `headers` 字段  

**`adapterType` 说明**  
- `chat`（默认）：OpenAI 消息格式，请求体使用 `messages` 数组  
- `flat`：原生绘图扁平格式，请求体直接平铺字段（不含 `messages` 包装）

**图片 URL 自动扫描**  
所有模式下，当 `responseImagePath` 未命中时，插件会自动扫描响应 JSON 中**第一个 HTTP/HTTPS URL** 作为图片地址——无需为不同平台精确配置图片路径。  

**Base64 / Data URI 处理说明**  
- 当 `responseImageFormat` 设为 `pure_base64` 时，插件会从 `responseImagePath` 取出纯 Base64 字符串，自动添加 `data:image/png;base64,` 前缀后发送。  
- 当设为 `data_uri` 时，插件会直接使用取出的完整 Data URI 或自动补全前缀。  
- 如果设为 `url` 但取出的却是 Base64 数据，插件也会尝试自动补全并发送（即有一定的容错能力）。

---

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| **Basic** | | |
| `debug` | Debug mode, logs full request/response | `false` |
| `apiStrategy` | API strategy: `sequence` / `roundrobin` | `roundrobin` |
| `timeout` | Request timeout (ms) | `300000` |
| `rateLimit` | Hourly call limit | `200` |
| `imgWaitTime` | Image upload wait timeout (seconds) | `60` |
| `model` | General model name | `gpt-image-2` |
| `txt2imgModel` | Text-to-image model override | (empty) |
| `img2imgModel` | Image-to-image model override | (empty) |
| `imageSize` | Default image size (WxH) | `1024x1024` |
| `maxImages` | Max reference images | `5` |
| `imageSendMode` | Image send mode: `image`, `url`, `both` | `image` |
| `enableForward` | Use forward message for multiple images | `true` |
| `enableTxt2Img` | Enable txt2img | `true` |
| `enableImg2Img` | Enable img2img | `true` |
| `responseImageFormat` | Image data format: `url`, `pure_base64`, `data_uri` | `url` |
| **API Config** | Each entry is a complete request template JSON | `[]` |
| `apiList[].enable` | Enable this API | `true` |
| `apiList[].example` | **(Textarea)** Request template JSON, see details below | default example |
| **Commands** | | |
| `command` | Txt2img command | `draw` |
| `aliases` | Command aliases | `[]` |
| `img2imgCommand` | Img2img command | `imgdraw` |
| `img2imgAliases` | Command aliases | `[]` |
| `redrawCommand` | Redraw command | `redraw` |
| `redrawAliases` | Redraw aliases | `['rd', '重绘']` |
| **Prompts** | | |
| `txt2imgPrompt` | Prompt template, var `{prompt}` | Chinese default |
| `img2imgPrompt` | Prompt template, vars `{url}` `{prompt}` | Chinese default |
| **Permissions** | | |
| `blacklistAdmins` | Admin QQ number list | `[]` |
| **Messages** | All messages customizable with template vars | see schema |

#### Request Template JSON (`example` field)

This is a **complete JSON object** that defines how to call the API. Supported fields (only `endpoint` is mandatory):

| Field | Description | Default |
|-------|-------------|---------|
| `endpoint` | **Required** API endpoint URL, supports `{model}` variable | - |
| `apiKey` | API key, optional | - |
| `headers` | Headers JSON object, supports `{apiKey}` | `{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}` |
| `txt2imgBody` | Txt2img request body template, vars `{model}` `{prompt}` `{size}` | `{"model":"{model}","prompt":"{prompt}","size":"{size}"}` |
| `img2imgBody` | Img2img request body template, vars `{model}` `{prompt}` `{size}` `{{image_urls}}` `{{image_objects}}` | depends on API |
| `responseImagePath` | JSON path to image data in response, e.g. `data.0.url` | `data.0.url` |
| `responseImageFormat` | Image format: `url` (HTTP link), `pure_base64` (pure Base64), `data_uri` (data:image/png;base64,...) | `url` |
| `adapterType` | Adapter type: `chat` (OpenAI message format, default) / `flat` (flat native draw format) | `chat` |
| `extraBody` | Extra JSON fields deep-merged into the final body | empty |
| `method` | HTTP method, default POST | `POST` |

**Variable placeholders**  
- `{model}` — Model name (from global or per-mode config)  
- `{prompt}` — Processed user prompt after template expansion  
- `{size}` — Image size (from `imageSize` config)  
- `{{image_urls}}` — URL array for DALL-E style APIs  
- `{{image_objects}}` — Chat Completions image object list for OpenAI Chat API  
- `{url}` — First image URL (string) for img2img  
- `{apiKey}` — API key, used only in `headers`

**`adapterType`**  
- `chat` (default): OpenAI message format — request body uses `messages` array  
- `flat`: Flat native draw format — request body fields are plain (no `messages` wrapper)

**Auto URL scanning**  
In all modes, when `responseImagePath` yields no match, the plugin auto-scans the response JSON for the **first HTTP/HTTPS URL** as the image address — no need to configure exact paths per platform.

**Base64 / Data URI**  
- `pure_base64`: takes raw Base64 from the specified path, prepends `data:image/png;base64,` before sending.  
- `data_uri`: expects a full Data URI string, or auto-prefixes if missing.  
- `url`: directly sends the image via HTTP link; if a Base64 string is detected, it will be auto-converted to a Data URI as a fallback.

---

## 自定义 API 端点示例 (Custom Endpoint Examples)

### DALL-E 风格 API（图片 URL 数组）
```json
{
  "endpoint": "https://api.agnes-ai.com/v1/images/generations",
  "apiKey": "sk-xxxx",
  "headers": {"Authorization":"Bearer {apiKey}","Content-Type":"application/json"},
  "txt2imgBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"size\":\"{size}\"}",
  "img2imgBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"size\":\"{size}\",\"extra_body\":{\"image\":{{image_urls}},\"response_format\":\"url\"}}",
  "responseImagePath": "data.0.url",
  "responseImageFormat": "url"
}
```

### OpenAI Chat Completions（图片对象列表）
```json
{
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "apiKey": "sk-xxxx",
  "headers": {"Authorization":"Bearer {apiKey}","Content-Type":"application/json"},
  "txt2imgBody": "{\"model\":\"{model}\",\"messages\":[{\"role\":\"user\",\"content\":\"{prompt}\"}]}",
  "img2imgBody": "{\"model\":\"{model}\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"{prompt}\"},{{image_objects}}]}]}",
  "responseImagePath": "choices.0.message.content",
  "responseImageFormat": "url"
}
```

## 依赖 (Dependencies)
- **数据库 (database)**：必须启用，用于黑名单持久化。
- **图生图 (img2img)**：需要 `assets` 服务及正确的 `selfUrl` 配置。

## 功能特性 (Features)
- 文生图 / 图生图，支持同时上传多张参考图片
- 多图合并转发 / 单图发送灵活切换，可配置发送方式（仅图片、仅链接、两者）
- API 轮询与负载均衡（sequence / roundrobin）
- 单个大文本框配置完整请求范式，变量自动替换，支持两种图片格式（URL 数组 / Chat 对象）
- 响应图片支持 **URL 直链、Base64 自动转换、Data URI 直传** 三种模式
- `extraBody` 深度合并任意 API 参数，一套配置兼容所有平台
- 黑名单管理（持久化到数据库）
- 全配置化提示文案，支持模板变量
- 调试日志、超时控制、频率限制

## 项目贡献者 (Contributors)
| 贡献者 (Contributor) | 贡献内容 (Contribution) |
| --- | --- |
| Minecraft-1314 | 插件完整开发 |
| Stalker-404 | 插件功能建议-base64格式传递参考图片-已添加 |
| （欢迎提交 PR / Issues 加入贡献者列表） |

## 许可协议 (License)
本项目采用 MIT 许可证，详情参见 LICENSE 文件。

This project is licensed under the MIT License, see the LICENSE file for details.

## 支持我们 (Support Us)
如果这个项目对您有帮助，欢迎点亮右上角的 Star 支持我们，这将是对所有贡献者最大的鼓励！

If this project is helpful to you, please feel free to star it in the upper right corner to support us, which will be the greatest encouragement to all contributors!

## 问题反馈 (Feedback)
如有问题或建议，可通过 Issues 提交反馈。

If you have any questions or suggestions, please submit feedback via Issues.
