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
**v1.5 universal adapter**: the `extraBody` field deep-merges arbitrary API parameters into requests — one config fits OpenAI, Stable Diffusion, Leonardo, Replicate, and all major platforms.

## 使用说明 (Usage)

### 中文

| 命令 (Command)                     | 功能说明 (Description) |
|------------------------------------|------------------------|
| `draw <提示词>`                  | 文生图：根据提示词直接生成图片 |
| `imgdraw <提示词>`               | 图生图：发送指令后在限定时间内上传参考图（可发送多张），输入"完成"或"done"结束收集并开始生成 |
| `blacklist list`                 | 查看当前黑名单（仅管理员） |
| `blacklist add <QQ号> [QQ号 ...]`  | 将指定 QQ 号加入黑名单（仅管理员） |
| `blacklist remove <QQ号> [QQ号 ...]` | 将指定 QQ 号移出黑名单（仅管理员） |

### English

| Command                             | Description |
|-------------------------------------|-------------|
| `draw <prompt>`                   | Text-to-image: Generate an image from the prompt |
| `imgdraw <prompt>`                | Image-to-image: Send the command, then upload one or more reference images within the time limit. Send "done" or "完成" to finish collecting and start generation |
| `blacklist list`                  | Show current blacklist (admin only) |
| `blacklist add <QQ_number> [QQ_number ...]` | Add QQ number(s) to blacklist (admin only) |
| `blacklist remove <QQ_number> [QQ_number ...]` | Remove QQ number(s) from blacklist (admin only) |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **🔧 基础设置** | | |
| `debug` | 调试模式，输出完整请求/响应日志 | `false` |
| `apiStrategy` | API 调度策略：`sequence`（顺序）/ `roundrobin`（轮询负载均衡） | `roundrobin` |
| `timeout` | API 请求超时时间（毫秒） | `300000` |
| `rateLimit` | 每小时调用次数上限 | `200` |
| `imgWaitTime` | 图生图等待用户上传图片的超时秒数 | `60` |
| **📝 模型** | | |
| `model` | 通用模型名称，文生图/图生图共用 | `gpt-4o-mini` |
| `txt2imgModel` | 文生图专用模型，留空则使用通用模型 | (空) |
| `img2imgModel` | 图生图专用模型，留空则使用通用模型 | (空) |
| `imageSize` | 默认图片尺寸（宽x高） | `1024x1024` |
| **🔗 API 列表** | 每个条目可独立配置端点、请求模板和透传参数 | `[]` |
| `apiList[].enable` | 是否启用此 API | `true` |
| `apiList[].apiKey` | API 密钥 | (空) |
| `apiList[].baseUrl` | 接口地址，支持 Chat Completions API | (空) |
| `apiList[].endpoint` | 自定义 API 完整 URL，支持 `{model}` 变量 | (空) |
| `apiList[].headers` | 请求头 JSON 模板，支持 `{apiKey}` 变量 | `{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}` |
| `apiList[].txt2imgBody` | 文生图请求体 JSON 模板，变量 `{model}` `{prompt}` `{size}` | `{"model":"{model}","prompt":"{prompt}","size":"{size}"}` |
| `apiList[].img2imgBody` | 图生图请求体 JSON 模板，变量 `{model}` `{prompt}` `{size}` `{{image_urls}}` | `{"model":"{model}","prompt":"{prompt}","size":"{size}","image":{{image_urls}}}` |
| `apiList[].responseImagePath` | 响应 JSON 中图片 URL 的字段路径，如 `data.0.url` | `data.0.url` |
| `apiList[].defaultSize` | 该 API 的默认尺寸，留空则使用全局 `imageSize` | (空) |
| `apiList[].extraBody` | ⭐ 万能适配层：额外 JSON 字段，深度合并到请求体 | (空) |
| **💬 指令** | | |
| `enableTxt2Img` | 启用文生图功能 | `true` |
| `command` | 文生图触发指令 | `draw` |
| `aliases` | 文生图指令别名 | `[]` |
| `enableImg2Img` | 启用图生图功能 | `true` |
| `img2imgCommand` | 图生图触发指令 | `imgdraw` |
| `img2imgAliases` | 图生图指令别名 | `[]` |
| `maxImages` | 图生图最大支持图片数量 | `5` |
| **✏️ 提示词模板** | | |
| `txt2imgPrompt` | 文生图提示模板，变量 `{prompt}` | 见默认 |
| `img2imgPrompt` | 图生图提示模板，变量 `{url}` `{prompt}` | 见默认 |
| **🚫 黑名单** | | |
| `blacklistAdmins` | 黑名单管理员 QQ 号列表 | `[]` |
| **💬 提示文案** | 所有提示文案均可自定义，支持模板变量 | 见配置页 |

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| **🔧 Basic** | | |
| `debug` | Debug mode, logs full request/response | `false` |
| `apiStrategy` | API strategy: `sequence` / `roundrobin` | `roundrobin` |
| `timeout` | Request timeout (ms) | `300000` |
| `rateLimit` | Hourly call limit | `200` |
| `imgWaitTime` | Image upload wait timeout (seconds) | `60` |
| **📝 Models** | | |
| `model` | General model name | `gpt-4o-mini` |
| `txt2imgModel` | Text-to-image model | (empty) |
| `img2imgModel` | Image-to-image model | (empty) |
| `imageSize` | Default image size (WxH) | `1024x1024` |
| **🔗 API List** | | `[]` |
| `apiList[].enable` | Enable this API | `true` |
| `apiList[].apiKey` | API key | (empty) |
| `apiList[].baseUrl` | Endpoint URL, Chat Completions API compatible | (empty) |
| `apiList[].endpoint` | Custom full URL, supports `{model}` | (empty) |
| `apiList[].headers` | Header JSON template, supports `{apiKey}` | default |
| `apiList[].txt2imgBody` | Txt2img body template, vars `{model}` `{prompt}` `{size}` | default |
| `apiList[].img2imgBody` | Img2img body template, vars `{model}` `{prompt}` `{size}` `{{image_urls}}` | default |
| `apiList[].responseImagePath` | JSON path to image URL in response | `data.0.url` |
| `apiList[].defaultSize` | Default size for this API | (empty) |
| `apiList[].extraBody` | ⭐ Universal adapter: extra JSON fields deep-merged into request | (empty) |
| **💬 Commands** | | |
| `enableTxt2Img` | Enable txt2img | `true` |
| `command` | Txt2img command | `draw` |
| `aliases` | Command aliases | `[]` |
| `enableImg2Img` | Enable img2img | `true` |
| `img2imgCommand` | Img2img command | `imgdraw` |
| `img2imgAliases` | Command aliases | `[]` |
| `maxImages` | Max reference images | `5` |
| **✏️ Prompts** | | |
| `txt2imgPrompt` | Prompt template, var `{prompt}` | Chinese default |
| `img2imgPrompt` | Prompt template, vars `{url}` `{prompt}` | Chinese default |
| **🚫 Blacklist** | | |
| `blacklistAdmins` | Admin QQ number list | `[]` |
| **💬 Messages** | All messages customizable with template vars | see schema |

---

## 万能适配层 — 参数映射参考 (Universal Adapter — Parameter Reference)

通过 `apiList[].extraBody` 字段，你可以向请求体注入**任意 JSON 字段**，实现一套配置兼容所有 API。以下是主流平台的参数映射关系。

### 1. 文本提示词 (Text Prompts)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `prompt` | string | 正向提示词，必填 | prompt (OpenAI, SD, Leonardo) |
| `negative_prompt` | string | 负向提示词，排除不希望出现的内容 | negative_prompt (SD), Midjourney --no |
| `model` / `engine` | string | 模型版本 | model (OpenAI), engine (SD), model_id (Replicate) |
| `num_images` / `n` | integer | 生成图片数量 | n (OpenAI), samples (SD), num_images (Leonardo) |

### 2. 图像尺寸与格式 (Size & Format)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `size` | string | 输出尺寸，如 `1024x1024` | size (OpenAI), width+height (SD, Leonardo) |
| `width` | integer | 宽度（像素） | SD, Leonardo, Replicate |
| `height` | integer | 高度（像素） | 同上 |
| `response_format` | string | 返回格式：`url` / `b64_json` | response_format (OpenAI), output_format (SD) |
| `output_format` | string | 文件格式：png, jpg, webp | SD, Leonardo |

### 3. 生成质量控制 (Quality Control)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `quality` | string | 图片质量：`standard` / `hd` | OpenAI DALL·E 3 |
| `steps` | integer | 扩散步数，越多越精细但更慢 | steps (SD, Leonardo) |
| `cfg_scale` / `guidance_scale` | number | 提示词引导强度（通常 1~20） | cfg_scale (SD), guidance_scale (Leonardo) |
| `sampler` / `scheduler` | string | 采样器，如 `DPM++ 2M Karras` | SD, Leonardo |
| `seed` | integer | 随机种子，固定可复现结果 | seed（几乎所有 API） |
| `clip_guidance_preset` | string | CLIP 引导预设 | SD |

### 4. 风格与美学控制 (Style & Aesthetics)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `style` | string | 预设风格，如 `vivid` / `natural` | OpenAI DALL·E 3 |
| `style_preset` | string | 增强风格，如 `cinematic`, `anime` | SD, Leonardo |
| `aesthetic_rating` | number | 美学评分权重 | 部分定制模型 |
| `stylization` / `stylize` | number | 风格化强度 | Midjourney --s |

### 5. 图生图 / 编辑专用 (Image-to-Image / Editing)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `image` / `init_image` | string/array | 输入图片（URL 或 Base64） | image (OpenAI edits), init_image (SD) |
| `mask` | string | 蒙版图片，指定编辑区域 | OpenAI mask, SD mask_image |
| `image_strength` / `denoising_strength` | number | 图生图变化程度，0~1 | SD image_strength (aka strength) |
| `preserve_original_dimensions` | boolean | 是否保持原图尺寸 | 多数平台自动或通过宽高控制 |

### 6. 高级 / 扩展参数 (Advanced / Extended)

| 参数 | 类型 | 说明 | 常见对应字段 |
|------|------|------|-------------|
| `loras` / `loras_weights` | array | 加载 LoRA 模型及权重 | 部分自定义端点，如 Replicate |
| `controlnet` | object | ControlNet 参数（姿势、深度等） | SD 生态 |
| `refiner` | object | 细化器参数 | SDXL 系列 |
| `composition` / `layout` | string | 构图控制 | 少数 API |
| `text_prompts` | array | 多提示词加权（类 SD WebUI） | SD, Replicate |
| `return_base64` | boolean | 是否返回 Base64 | 部分 API 特有 |

### 使用示例

```json
{
  "enable": true,
  "apiKey": "sk-xxxx",
  "endpoint": "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
  "txt2imgBody": "{\"text_prompts\":[{\"text\":\"{prompt}\",\"weight\":1}],\"height\":1024,\"width\":1024}",
  "extraBody": "{\"cfg_scale\":7,\"steps\":30,\"sampler\":\"K_DPMPP_2M\",\"seed\":0,\"style_preset\":\"cinematic\"}",
  "responseImagePath": "artifacts.0.base64"
}
```

`extraBody` 中的字段会**深度合并**到模板生成的请求体中，同名顶层字段以 `extraBody` 为准。你可以只填写需要覆盖或追加的参数，无需修改模板。

---

## 自定义 API 端点示例 (Custom Endpoint Examples)

### 接入 OpenAI Chat Completions（默认）
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
  "responseImagePath": "data.0.url",
  "defaultSize": "1024x1024"
}
```

### 接入 Stable Diffusion (Stability AI)
```json
{
  "enable": true,
  "apiKey": "sk-xxxx",
  "endpoint": "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
  "headers": "{\"Authorization\":\"Bearer {apiKey}\",\"Content-Type\":\"application/json\",\"Accept\":\"application/json\"}",
  "txt2imgBody": "{\"text_prompts\":[{\"text\":\"{prompt}\",\"weight\":1}],\"height\":1024,\"width\":1024}",
  "extraBody": "{\"cfg_scale\":7,\"steps\":30,\"sampler\":\"K_DPMPP_2M\",\"seed\":0,\"style_preset\":\"cinematic\"}",
  "responseImagePath": "artifacts.0.base64",
  "defaultSize": "1024x1024"
}
```

### 接入 Leonardo AI
```json
{
  "enable": true,
  "apiKey": "leo-xxxx",
  "endpoint": "https://cloud.leonardo.ai/api/rest/v1/generations",
  "headers": "{\"Authorization\":\"Bearer {apiKey}\",\"Content-Type\":\"application/json\"}",
  "txt2imgBody": "{\"prompt\":\"{prompt}\",\"modelId\":\"{model}\",\"width\":1024,\"height\":1024}",
  "extraBody": "{\"num_images\":1,\"guidance_scale\":7,\"presetStyle\":\"DYNAMIC\",\"alchemy\":true}",
  "responseImagePath": "generations_by_pk.generated_images.0.url"
}
```

## 依赖 (Dependencies)
- **数据库 (database)**：必须启用，用于黑名单持久化。
- **图生图 (img2img)**：需要 `assets` 服务及正确的 `selfUrl` 配置。

## 功能特性 (Features)
- 文生图 / 图生图，支持同时上传多张参考图片
- API 轮询与负载均衡（sequence / roundrobin）
- 自定义端点、请求体模板、请求头模板
- 万能适配层 `extraBody`：深度合并任意 API 参数，一套配置兼容所有平台
- 黑名单管理（持久化到数据库）
- 全配置化提示文案，支持模板变量
- 调试日志、超时控制、频率限制

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
