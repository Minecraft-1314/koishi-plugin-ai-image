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
Built‑in multi‑API load balancing, debug logging, timeout mechanism, fully configurable messages and prompt templates. Flexible configuration, ready to use, stable and reliable.  
Image‑to‑image supports **multiple reference images** with configurable maximum count.  
**Blacklist management** with database persistence, administrators can add/remove users and view the blacklist via commands.

## 使用说明 (Usage)

### 中文

| 命令 (Command)                     | 功能说明 (Description) |
|------------------------------------|------------------------|
| `draw <提示词>`                  | 文生图：根据提示词直接生成图片 |
| `imgdraw <提示词>`               | 图生图：发送指令后在限定时间内上传参考图（可发送多张），输入“完成”或“done”结束收集并开始生成 |
| `blacklist list`                 | 查看当前黑名单（仅管理员） |
| `blacklist add <QQ号> [QQ号 ...]`  | 将指定 QQ 号加入黑名单（仅管理员） |
| `blacklist remove <QQ号> [QQ号 ...]` | 将指定 QQ 号移出黑名单（仅管理员） |

### English

| Command                             | Description |
|-------------------------------------|-------------|
| `draw <prompt>`                   | Text-to-image: Generate an image from the prompt |
| `imgdraw <prompt>`                | Image-to-image: Send the command, then upload one or more reference images within the time limit. Send “done” or “完成” to finish collecting and start generation |
| `blacklist list`                  | Show current blacklist (admin only) |
| `blacklist add <QQ_number> [QQ_number ...]` | Add QQ number(s) to blacklist (admin only) |
| `blacklist remove <QQ_number> [QQ_number ...]` | Remove QQ number(s) from blacklist (admin only) |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **🔧 基础设置** | | |
| `debug` | 调试模式 | `false` |
| `apiStrategy` | API 调度策略 | `roundrobin` |
| `timeout` | 超时时间（毫秒） | `300000` |
| `rateLimit` | 每小时调用限制 | `200` |
| `imgWaitTime` | 图生图等待时间（秒） | `60` |
| ** 模型** | | |
| `model` | 通用模型 | `gpt-4o-mini` |
| `txt2imgModel` | 文生图模型 | (空) |
| `img2imgModel` | 图生图模型 | (空) |
| `imageSize` | 默认尺寸 | `1024x768` |
| **🔗 API 列表** | | |
| `apiList` | 多账号配置 | `[]` |
| `apiList[].enable` | 启用 | `true` |
| `apiList[].apiKey` | API 密钥 | (空) |
| `apiList[].baseUrl` | 旧版 Chat Completions 地址 | (空) |
| `apiList[].endpoint` | 自定义端点 URL | (空) |
| `apiList[].headers` | 请求头模板 | 见默认 |
| `apiList[].txt2imgBody` | 文生图请求体模板 | 见默认 |
| `apiList[].img2imgBody` | 图生图请求体模板 | 见默认 |
| `apiList[].responseImagePath` | 图片路径 | `data.0.url` |
| `apiList[].defaultSize` | 默认尺寸 | (空) |
| **💬 指令** | | |
| `enableTxt2Img` | 启用文生图 | `true` |
| `command` | 文生图指令 | `draw` |
| `aliases` | 别名 | `[]` |
| `enableImg2Img` | 启用图生图 | `true` |
| `img2imgCommand` | 图生图指令 | `imgdraw` |
| `img2imgAliases` | 别名 | `[]` |
| `maxImages` | 最大图片数 | `5` |
| ** 提示词模板** | | |
| `txt2imgPrompt` | 文生图模板 | 默认中文 |
| `img2imgPrompt` | 图生图模板 | 默认中文 |
| ** 黑名单** | | |
| `blacklistAdmins` | 管理员 QQ 列表 | `[]` |
| ** 提示文案** | 均可自定义 | 略 |

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| `debug` | Debug mode | `false` |
| `apiStrategy` | `sequence` / `roundrobin` | `roundrobin` |
| `timeout` | Request timeout (ms) | `300000` |
| `rateLimit` | Hourly limit | `200` |
| `imgWaitTime` | Wait for image (s) | `60` |
| `model` | General model | `gpt-4o-mini` |
| `txt2imgModel` | Txt2img model | (empty) |
| `img2imgModel` | Img2img model | (empty) |
| `imageSize` | Default size | `1024x768` |
| `apiList` | API entries | `[]` |
| `apiList[].enable` | Enable | `true` |
| `apiList[].apiKey` | API key | (empty) |
| `apiList[].baseUrl` | Legacy endpoint | (empty) |
| `apiList[].endpoint` | Custom endpoint | (empty) |
| `apiList[].headers` | Header template | default |
| `apiList[].txt2imgBody` | Txt2img body template | default |
| `apiList[].img2imgBody` | Img2img body template | default |
| `apiList[].responseImagePath` | Image URL path | `data.0.url` |
| `apiList[].defaultSize` | Default size | (empty) |
| `enableTxt2Img` | Enable txt2img | `true` |
| `command` | Txt2img command | `draw` |
| `aliases` | Aliases | `[]` |
| `enableImg2Img` | Enable img2img | `true` |
| `img2imgCommand` | Img2img command | `imgdraw` |
| `img2imgAliases` | Aliases | `[]` |
| `maxImages` | Max images | `5` |
| `txt2imgPrompt` | Prompt template | Chinese default |
| `img2imgPrompt` | Prompt template | Chinese default |
| `blacklistAdmins` | Admin QQ list | `[]` |
| Messages | Fully configurable | (see schema) |

## 自定义 API 端点示例 (Custom Endpoint Examples)

### 接入 OpenAI 标准 Chat Completions 接口
```json
{
  "enable": true,
  "apiKey": "sk-xxxx",
  "baseUrl": "https://api.openai.com/v1/chat/completions"
}
```

### 接入 OpenAI Images API
```json
{
  "enable": true,
  "apiKey": "sk-xxxx",
  "endpoint": "https://api.openai.com/v1/images/generations",
  "txt2imgBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"size\":\"{size}\",\"n\":1}",
  "img2imgBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"size\":\"{size}\",\"image\":{{image_urls}},\"n\":1}",
  "responseImagePath": "data.0.url",
  "defaultSize": "1024x1024"
}
```

## 依赖 (Dependencies)
- **数据库**：必须启用 `database` 服务。
- **图生图**：需要 `assets` 服务及正确的 `selfUrl`。

## 功能特性 (Features)
- 文生图/图生图，多图支持
- API 轮询与负载均衡
- 自定义端点与模板
- 黑名单管理
- 调试日志等

## 项目贡献者 (Contributors)
| 贡献者 (Contributor) | 贡献内容 (Contribution) |
| --- | --- |
| Minecraft-1314 | 插件完整开发 (Complete plugin development) |
| （欢迎提交 PR 加入贡献者列表） | （Welcome to submit PR to join the contributor list） |

## 许可协议 (License)
本项目采用 MIT 许可证，详情参见 LICENSE 文件。

This project is licensed under the MIT License, see the LICENSE file for details.

## 支持我们 (Support Us)
如果这个项目对您有帮助，欢迎点亮右上角的 Star ⭐ 支持我们，这将是对所有贡献者最大的鼓励！

If this project is helpful to you, please feel free to star it in the upper right corner ⭐ to support us, which will be the greatest encouragement to all contributors!

## 问题反馈 (Feedback)
如有问题或建议，可通过 Issues 提交反馈。

If you have any questions or suggestions, please submit feedback via Issues.