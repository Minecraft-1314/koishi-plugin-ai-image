# koishi-plugin-ai-image

## 项目介绍 (Project Introduction)

### 中文
一款为 Koishi 聊天机器人框架开发的 AI 绘图插件，支持**文生图 + 图生图**，**严格兼容 OpenAI 标准接口**。  
内置多 API 负载均衡、详细调试日志、超时等待机制、全配置化提示文案（含自定义提示模板），配置简单、开箱即用、稳定可靠。  
图生图支持同时发送**多张参考图片**，并可自定义最大图片数量。  
提供**黑名单管理**功能，数据持久化到数据库，管理员可通过指令添加、移除用户及查看黑名单。

### English
An AI image generation plugin for the Koishi chatbot framework, supporting **text-to-image & image-to-image**.  
Strictly compatible with OpenAI‑standard APIs. Built‑in multi‑API load balancing, debug logging, timeout mechanism, fully configurable messages and prompt templates. Easy setup, ready to use, stable and reliable.  
Image‑to‑image supports **multiple reference images** with configurable maximum count.  
**Blacklist management** with database persistence, administrators can add/remove users and view the blacklist via commands.

## 使用说明 (Usage)

### 中文

| 命令 (Command)                     | 功能说明 (Description) |
|------------------------------------|------------------------|
| `draw <提示词>`                    | 文生图：根据提示词直接生成图片 |
| `imgdraw <提示词>`                 | 图生图：发送指令后在限定时间内上传参考图（可发送多张），输入“完成”或“done”结束收集并开始生成 |
| `blacklist list`                   | 查看当前黑名单（仅管理员） |
| `blacklist add <QQ号> [QQ号 ...]`  | 将指定 QQ 号加入黑名单（仅管理员） |
| `blacklist remove <QQ号> [QQ号 ...]` | 将指定 QQ 号移出黑名单（仅管理员） |

### English

| Command                             | Description |
|-------------------------------------|-------------|
| `draw <prompt>`                     | Text-to-image: Generate an image from the prompt |
| `imgdraw <prompt>`                  | Image-to-image: Send the command, then upload one or more reference images within the time limit. Send “done” or “完成” to finish collecting and start generation |
| `blacklist list`                    | Show current blacklist (admin only) |
| `blacklist add <QQ_number> [QQ_number ...]` | Add QQ number(s) to blacklist (admin only) |
| `blacklist remove <QQ_number> [QQ_number ...]` | Remove QQ number(s) from blacklist (admin only) |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **🔧 基础设置** | | |
| `debug` | 调试模式（输出完整请求/响应日志） | `false` |
| `apiStrategy` | API 调度策略：`sequence`（顺序）/ `roundrobin`（负载均衡） | `roundrobin` |
| `timeout` | API 请求超时时间（毫秒） | `300000` |
| `rateLimit` | 每小时调用频率限制 | `200` |
| `imgWaitTime` | 图生图等待用户发送图片的超时时间（秒） | `60` |
| **📝 模型** | | |
| `model` | 通用模型名称 | `gpt-4o-mini` |
| `txt2imgModel` | 文生图专用模型（留空使用通用模型） | (空) |
| `img2imgModel` | 图生图专用模型（留空使用通用模型） | (空) |
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
| `maxImages` | 图生图最大支持图片数量 | `5` |
| **✏️ 提示词模板** | | |
| `txt2imgPrompt` | 文生图提示模板，变量 `{prompt}` | `请严格遵循我的要求生成一张图片...` |
| `img2imgPrompt` | 图生图提示模板，变量 `{url}` 和 `{prompt}` | `图片链接：{url} 请严格根据以下指令...` |
| **🚫 黑名单** | | |
| `blacklistAdmins` | 允许管理黑名单的 QQ 号列表 | `[]` |
| **💬 提示文案** | | |
| `messages.generating` | 生成中提示 | `⏳ 生成中...` |
| `messages.waitImage` | 等待图片提示 | `请在60秒内发送需要编辑的图片` |
| `messages.timeout` | 等待超时提示 | `等待图片超时，已取消` |
| `messages.empty` | 无提示词提示 | `❌ 请输入提示词` |
| `messages.noApi` | 无可用API提示 | `❌ 未配置可用API` |
| `messages.fail` | 生成失败提示 | `❌ 生成失败` |
| `messages.modelTextOnly` | 模型仅返回文本提示 | `❌ 模型未生成图片，返回文字：{text}` |
| `messages.needAssets` | 缺少 assets 服务提示 | `❌ 图生图需要正确配置 assets 服务...` |
| `messages.txt2imgDisabled` | 文生图未启用提示 | `❌ 文生图功能未启用` |
| `messages.img2imgDisabled` | 图生图未启用提示 | `❌ 图生图功能未启用` |
| `messages.rateLimit` | 频率限制提示 | `❌ 调用次数已达上限，请稍后再试` |
| `messages.alreadyWaiting` | 重复等待提示 | `你已在等待发送图片...` |
| `messages.multiImageReceived` | 多图接收提示，变量 `{count}` | `已收到 {count} 张图片，可继续发送或输入“完成”开始生成` |
| `messages.multiImageLimit` | 达到图片上限提示 | `已达到最大图片数量，自动开始生成` |
| `messages.noImageReceived` | 未收到图片提示 | `未发送任何图片` |
| `messages.blacklisted` | 黑名单用户提示 | `❌ 你已被加入黑名单，无法使用绘图功能` |
| `messages.noPermission` | 无黑名单管理权限提示 | `❌ 你没有权限管理黑名单` |
| `messages.blacklistAddSuccess` | 添加成功提示，`{targets}` 为QQ号 | `✅ 已将 {targets} 加入黑名单` |
| `messages.blacklistRemoveSuccess` | 移除成功提示 | `✅ 已将 {targets} 移出黑名单` |
| `messages.blacklistAddFail` | 添加失败提示 | `⚠️ {targets} 已在黑名单中或无效` |
| `messages.blacklistRemoveFail` | 移除失败提示 | `⚠️ {targets} 不在黑名单中` |
| `messages.invalidUserId` | 无效QQ号提示 | `⚠️ 无效的QQ号：{targets}` |
| `messages.blacklistListEmpty` | 黑名单为空提示 | `✅ 当前黑名单为空` |
| `messages.blacklistListTitle` | 黑名单列表标题 | `📋 当前黑名单：` |

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| **🔧 Basic** | | |
| `debug` | Enable debug logging | `false` |
| `apiStrategy` | API strategy: `sequence` / `roundrobin` | `roundrobin` |
| `timeout` | Request timeout in milliseconds | `300000` |
| `rateLimit` | Hourly API call limit | `200` |
| `imgWaitTime` | Wait time for user to send images (seconds) | `60` |
| **📝 Model** | | |
| `model` | General model name | `gpt-4o-mini` |
| `txt2imgModel` | Model for text-to-image (leave empty to use general) | (empty) |
| `img2imgModel` | Model for image-to-image (leave empty to use general) | (empty) |
| **🔗 API List** | | |
| `apiList` | API configurations for load balancing | `[]` |
| `apiList[].enable` | Enable this API entry | `true` |
| `apiList[].apiKey` | API key | (empty) |
| `apiList[].baseUrl` | API endpoint (OpenAI format required) | (empty) |
| **💬 Commands** | | |
| `enableTxt2Img` | Enable text-to-image | `true` |
| `command` | Text-to-image command | `draw` |
| `aliases` | Aliases for text-to-image command | `[]` |
| `enableImg2Img` | Enable image-to-image | `true` |
| `img2imgCommand` | Image-to-image command | `imgdraw` |
| `img2imgAliases` | Aliases for image-to-image command | `[]` |
| `maxImages` | Maximum reference images for img2img | `5` |
| **✏️ Prompt Templates** | | |
| `txt2imgPrompt` | Template with `{prompt}` | (Chinese default) |
| `img2imgPrompt` | Template with `{url}` and `{prompt}` | (Chinese default) |
| **🚫 Blacklist** | | |
| `blacklistAdmins` | QQ numbers allowed to manage blacklist | `[]` |
| **💬 Messages** | | |
| `messages.generating` | Generating message | `⏳ Generating...` |
| `messages.waitImage` | Prompt to send image | `Please send image within 60s` |
| `messages.timeout` | Timeout message | `Image wait timeout, canceled` |
| `messages.empty` | Empty prompt | `❌ Please enter a prompt` |
| `messages.noApi` | No API available | `❌ No available API` |
| `messages.fail` | Failure message | `❌ Generation failed` |
| `messages.modelTextOnly` | Model returned text only | `❌ Model did not generate an image, returned text: {text}` |
| `messages.needAssets` | Assets service required | `❌ Assets service with proper selfUrl required` |
| `messages.txt2imgDisabled` | Text-to-image disabled | `❌ Text-to-image is disabled` |
| `messages.img2imgDisabled` | Image-to-image disabled | `❌ Image-to-image is disabled` |
| `messages.rateLimit` | Rate limit reached | `❌ API call limit reached` |
| `messages.alreadyWaiting` | Already waiting for images | `You are already waiting...` |
| `messages.multiImageReceived` | Received images feedback | `Received {count} image(s)...` |
| `messages.multiImageLimit` | Max images reached | `Maximum image count reached, auto-starting` |
| `messages.noImageReceived` | No images received | `No images received` |
| `messages.blacklisted` | Blacklisted user | `❌ You are blacklisted` |
| `messages.noPermission` | No admin permission | `❌ No permission` |
| `messages.blacklistAddSuccess` | Add success | `✅ {targets} added` |
| `messages.blacklistRemoveSuccess` | Remove success | `✅ {targets} removed` |
| `messages.blacklistAddFail` | Add failed | `⚠️ {targets} already blacklisted/invalid` |
| `messages.blacklistRemoveFail` | Remove failed | `⚠️ {targets} not in blacklist` |
| `messages.invalidUserId` | Invalid QQ number | `⚠️ Invalid QQ number: {targets}` |
| `messages.blacklistListEmpty` | Blacklist empty | `✅ The blacklist is empty` |
| `messages.blacklistListTitle` | Blacklist title | `📋 Current blacklist:` |

## 依赖 (Dependencies)

- **数据库**：本插件**必须**启用 `database` 服务（如 `@koishijs/plugin-database-sqlite`），用于持久化黑名单数据。
- **图生图**：需要安装并启用 `@koishijs/plugin-assets-local`（或其他 `assets` 服务插件），并正确设置 `selfUrl`（全局配置）。

## 兼容接口 (Supported API)

仅支持 **OpenAI 标准接口**  
- `/v1/chat/completions`

## 功能特性

- 文生图 / 图生图，指令独立
- 图生图支持多张参考图，自动合并上传
- 多 API 密钥轮询与负载均衡（顺序 / 轮询策略）
- 自定义提示词模板，变量灵活
- 智能识别 API 错误类型（超时、网络、请求错误、服务器错误）
- 全配置化提示文案
- 黑名单管理，数据库持久化，管理员可添加/移除/查看黑名单（仅支持 QQ 号，不支持 @）
- 详细调试日志
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