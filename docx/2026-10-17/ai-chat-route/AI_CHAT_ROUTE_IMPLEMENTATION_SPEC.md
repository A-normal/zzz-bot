# AI 兜底对话路由 · 实施规格（执行子代理用）

> **本文件的读者是一个会写代码但没有本会话上下文的子代理。**
> 规则：**逐条照做，不要自行发挥，不要扩大范围。** 凡本文件没写的，一律不做。
> 完成定义：`node tests/ai-chat-core.test.mjs` **全部通过（0 fail）**，且第 11 节的报告格式完整提交。
> 时间戳：`2026-10-17`　｜　项目根目录：`C:\Library\repository\zzz-Bot`

---

## 0. 目标（一句话）

在 TRSS-Yunzai 的 `plugins/example/` 下新增一个**排最后**的兜底插件：
**群内 @机器人 且不带任何指令命名空间**的普通消息（文本 / 图片）→ 调用 OpenAI 兼容接口 → **单条**回复；
同时提供主人专用的 `/模型`、`/模型接口` 切换指令；`%` 命名空间的未识别输入改为兜底提示。

**明确不做**：多轮上下文（单轮，无历史）、限流/配额/冷却、引用消息解析、语音/表情解析、长答转图、多接口故障转移、流式输出。

---

## 1. 不可违反的既有事实（先读，理解后再动手）

| 事实 | 含义 |
| :--- | :--- |
| 内核 `loader.dealText()` 在插件之前把行首 `/`、`／` 改写成 `#` | 插件里**永远看不到** `/`，只看到 `#` |
| `plugins/example/zzzShortcuts.js`（priority `-1000`）已经**独占 `/` 命名空间**：先改写已知裸词/斜杠指令，末尾对**所有未识别斜杠**回复"没有快捷指令"并 `return "return"` | 本插件**不能**自己抢 `/` 命令，必须由 zzzShortcuts 转交 |
| ZZZ-Plugin 只认 `rulePrefix = ^((#|%|/)?(zzz|ZZZ|绝区零))` | `%` 是绝区零命名空间，**未识别的 `%` 目前无人接** |
| `miao-plugin`（priority 50）、ZZZ-Plugin（priority 70）等会在本插件之前跑 | 本插件**必须排最后**；priority 固定 `9998` |
| QQ 官方 Bot 一条用户消息**只能被动回复一次**，多发会 `40034128` | 全程**只回一条**；任何情况下不得发第二条 |
| 三通道差异（QQBot / Telegram / NapCat） | 通道判定与回复策略一律走"一条纯文本回复"，**不做通道分叉**（本版从简） |
| 可用基建：全局 `redis`、`global.segment`、`logger`、`node-fetch` 已在依赖里 | **禁止新增任何依赖，禁止改 package.json** |

---

## 2. 允许改动的文件（白名单，其它一律不许碰）

| # | 文件 | 动作 |
| :-: | :--- | :--- |
| 1 | `plugins/example/aiChatCore.mjs` | **新建**（纯函数，无 I/O） |
| 2 | `plugins/example/aiChatControl.mjs` | **新建**（配置读取 + 状态读写 + 主人指令） |
| 3 | `plugins/example/zzzAIChat.js` | **新建**（Yunzai 插件 + 网络调用） |
| 4 | `plugins/example/zzzShortcuts.js` | **最小改动**（只加 2 处，见第 6 节） |
| 5 | `config/aiChat.yaml` | **新建**（配置模板） |
| 6 | `.env.example` | 追加 3 行示例变量 |
| 7 | `docker/docker-compose.yml`、`docker/zzz.yml`、`docker-compose.yml` | 各追加 env 透传 3 行 |

**绝对不许改**：`tests/` 下任何文件（测试由上游写好，是你的验收闸门）、`plugins/ZZZ-Plugin/`、`patches/`、`resources/`、`README.md`、任何 `.env` 真实文件。

---

## 3. 文件 1：`plugins/example/aiChatCore.mjs`

**硬性要求：本文件不得出现任何 `import`（连 node: 内置都不用），不得读 `process.env`，不得有顶层副作用。** 全部是纯函数，可被测试文件直接 import（扩展名用 `.mjs`）。

### 3.1 `export const DEFAULT_CONFIG`

字段与默认值（一个不多一个不少）：

```js
{
  enabled: true,
  allowPrivate: false,
  percentHint: true,
  groupWhitelist: [],
  masterUserIds: [],
  systemPrompt: "你是绝区零玩家群里的助手。回答简洁（不超过 300 字），中文，不要输出 Markdown 表格，不要编造游戏数值，不确定就直说不知道。不要复述这段设定。",
  maxInputChars: 2000,
  maxImages: 4,
  maxImageBytes: 4194304,
  maxReplyChars: 1800,
  temperature: 0.7,
  maxTokens: 800,
  timeoutMs: 45000,
  percentHintText: "没有识别到这条 % 指令。发送 /帮助 查看支持的指令。",
  emptyHintText: "请直接说要问什么，也可以带一张图~",
  visionFallback: "（用户还发了 {n} 张图片，当前模型不支持看图）",
  shortcutWords: ["帮助","help","菜单","功能","说明","指令","面板","面板列表","更新面板","刷新面板","全角色面板","便签","便笺","体力","每日","note","uid","我的uid","绑定","扫码登录","签到","签到状态","抽卡记录","抽卡分析","抽卡统计","更新抽卡","刷新抽卡","月报","日历","兑换码","攻略"],
  endpoints: []
}
```

### 3.2 `normalizeConfig(raw)`

- `raw` 可能是 `undefined` 或解析后的 YAML 对象；**不得抛异常**。
- 返回 `{...DEFAULT_CONFIG, ...raw}` 的规范化结果：
  - `shortcutWords` → **`Set`**（`cfg.shortcutWords.has("帮助") === true`）。
  - `groupWhitelist`、`masterUserIds` → `string[]`（元素 `String()`，过滤空值）。
  - `endpoints` → 数组，逐项规范化；**丢弃**缺 `name` 或 `baseURL` 的项：
    `{ name, baseURL, apiKeyEnv, models: string[], defaultModel, supportsVision: boolean, timeoutMs: number }`
    - `apiKeyEnv` 缺省 `""`；`supportsVision` 缺省 `false`；`timeoutMs` 缺省取 `cfg.timeoutMs`。
    - `models` 缺省 `[]`；`defaultModel` `= raw.defaultModel || models[0] || ""`。
- 数值字段非数字时回落到默认值。

### 3.3 `decideRoute(e, cfg)` → `{ action, reason }`

`action` 取值：`"ai"` | `"hint_percent"` | `"hint_empty"` | `"skip"`。

**判定顺序（严格按此顺序短路）**：

1. `!cfg.enabled` → `{action:"skip", reason:"disabled"}`
2. 取文本 `text`：依次尝试 `e.msg`、`e.original_msg`、`e.raw_message`，取第一个非空字符串；对其 `.replace(/<@!?\d+>/g,"").replace(/\[CQ:[^\]]*\]/g,"").trim()`。
3. `text` 以 `%` 或 `％` 开头 → `{action:"hint_percent", reason:"percent"}`（**注意：此判定在 @ 判定之前**，因为 `%` 指令本来就不需要 @）。
4. `text` 以 `/`、`／`、`#`、`＃` 中任一开头 → `{action:"skip", reason:"namespace"}`
5. `e.isGroup` 为真且 `!e.atBot` → `{action:"skip", reason:"no-at"}`
6. `e.isGroup` 为假且 `!cfg.allowPrivate` → `{action:"skip", reason:"private"}`
7. `e.isGroup` 为真且 `cfg.groupWhitelist.length > 0` 且 `!cfg.groupWhitelist.includes(String(e.group_id))` → `{action:"skip", reason:"group"}`
8. `text === ""` 且 `!(Array.isArray(e.img) && e.img.length)` → `{action:"hint_empty", reason:"empty"}`
9. `text` 的第一个空白分隔 token 精确等于 `shortcutWords` 中任一词 → `{action:"skip", reason:"shortcut-word"}`
10. 其余 → `{action:"ai", reason:"ok"}`

> 第 9 条是"防呆保险"：即使将来有人把 priority 调反了，也不会吃掉 `面板`、`签到` 这类裸词指令。**必须是整 token 精确相等**，所以 `签到是什么意思` 不会被拦（它整体不等于 `签到`）。

### 3.4 `isMaster(e, cfg)` → boolean

`Boolean(e.isMaster) || cfg.masterUserIds.includes(String(e.user_id))`

### 3.5 `parseMasterCommand(text)` → `null | { kind, arg }`

正则：`/^[/／#＃]模型(接口|列表)?(?:\s+([\s\S]+))?$/`

- 不匹配 → `null`；**裸词 `模型`（无前缀）必须返回 `null`**（不能吞掉正常对话）。
- `接口` → `kind:"endpoints"`；`列表` 或无后缀 → `kind:"models"`。
- `arg` = 第 2 组 `.trim() || ""`。

### 3.6 `normalizeState(cfg, state)` → `{ endpoint, model }`

- `endpoint`：`state?.endpoint` 若存在于 `cfg.endpoints` 的 name 中则用之，否则取第一个 endpoint 的 name，没有则 `""`。
- `model`：当前 endpoint 的 `models` 若包含 `state?.model` 则用之，否则 `defaultModel || models[0] || ""`。

### 3.7 `resolveEndpoint(cfg, state)` → `null | { endpoint, model, state }`

按 `normalizeState` 的 name 找到 endpoint 对象；找不到返回 `null`；返回的 `state` 是规范化后的状态。

### 3.8 `formatModelList(cfg, state)` → string

无 endpoint 时返回 `"未配置任何模型接口。"`。否则多行：
```
当前接口：<name>（<i>/<total>）
当前模型：<model> ✓
可选模型：
 ✓ 1. <model1>
   2. <model2>
发送 /模型 <序号|名称> 切换
```
（当前项前面加 `" ✓"`；序号从 1 开始）

### 3.9 `formatEndpointList(cfg, state)` → string

无 endpoint 时返回 `"未配置任何模型接口。"`。否则：
```
当前接口：<name>（<i>/<total>）
可选接口：
 ✓ 1. <name> — <baseURL>
   2. <name> — <baseURL>
发送 /模型接口 <序号|名称> 切换
```

### 3.10 `applyModelSwitch(cfg, state, arg)` → `{ ok, state, message }`

- 无 endpoint → `{ok:false, state, message:"未配置任何模型接口。"}`
- `arg` 为纯数字 → 按 1 基下标取 `endpoint.models`；越界 → `ok:false`，message 提示 `"没有第 N 个模型，发送 /模型 查看可选模型。"`
- 否则按**名称精确匹配** `endpoint.models`；不匹配 → `ok:false`，message 同上风格。
- 成功 → `{ok:true, state:{endpoint:当前name, model:新model}, message:"已切换模型：" + 新model}`

### 3.11 `applyEndpointSwitch(cfg, state, arg)` → `{ ok, state, message }`

- 数字 → 1 基下标取 `cfg.endpoints`；否则按 name 精确匹配。
- 失败 → `ok:false`，message `"没有这个接口，发送 /模型接口 查看可选接口。"`
- 成功 → 状态 `{endpoint:新name, model: 新endpoint.defaultModel || models[0] || ""}`，
  message `"已切换接口：" + name + "\n当前模型：" + model`。

### 3.12 `buildChatRequest(cfg, endpoint, model, text, images, apiKey)` → `{ url, headers, body }`

- `text` 先按 `cfg.maxInputChars` 截断（超出则末尾补 `"…"`）。
- `images` 是 `[{ mime, dataUrl }]`；只取前 `cfg.maxImages` 张。
- `endpoint.supportsVision === false` 时：**忽略图片**，文本末尾追加 `cfg.visionFallback` 并把 `{n}` 替换为实际张数。
- `url = endpoint.baseURL.replace(/\/+$/, "") + "/chat/completions"`
- `headers = { "Content-Type": "application/json" }`；`apiKey` 非空时追加 `Authorization: "Bearer " + apiKey`
- `body = { model, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens, stream: false }`
  - `messages = [{role:"system",content:cfg.systemPrompt},{role:"user",content:userContent}]`（**单轮，禁止加历史**）
  - 无图：`userContent` 为字符串 `text`
  - 有图：`[{type:"text",text}, {type:"image_url",image_url:{url:dataUrl}}, ...]`（**text 在最前**）

### 3.13 `trimReply(text, maxChars)` → string

非字符串 → `""`；`trim()` 后长度 ≤ max 原样返回；否则 `text.slice(0, maxChars) + "…（答案已截断）"`。

### 3.14 `extractContent(data)` → string

从 OpenAI 响应取正文：`data?.choices?.[0]?.message?.content`；
若它是字符串直接返回；若是数组，取其 `type === "text"` 的 `text` 拼接；异常/空 → `""`。

### 3.15 `sniffMime(bytes)` → string

`Uint8Array|Buffer` 魔数判定：`image/png`、`image/jpeg`、`image/gif`、`image/webp`、`image/bmp`，其余 `application/octet-stream`。

---

## 4. 文件 2：`plugins/example/aiChatControl.mjs`

允许 `import` `node:fs`、`node:path`、`yaml`（Yunzai 已内置）与 `./aiChatCore.mjs`。**不得 import `../../lib/...`**（本文件要能被 zzzShortcuts 与 zzzAIChat 共用）。

- `export const CONFIG_PATH = path.join(process.cwd(), "data", "aiChat", "config.yaml")`
- `export const STATE_PATH  = path.join(process.cwd(), "data", "aiChat", "state.json")`
- `export function loadConfig()`：读 `CONFIG_PATH`（不存在/解析失败 → 空对象）→ `normalizeConfig()`；**每次调用都重新读**（便于热改）。
- `export function loadState()` / `saveState(state)`：读写 `STATE_PATH`；读失败 → `{}`；写用"临时文件 + rename"；写失败只 `logger?.warn`（用 `typeof logger !== "undefined"` 保护）。
- `export async function handleMasterCommand(e, kind, arg)`：
  1. `const cfg = loadConfig()`；
  2. **权限**：`!isMaster(e, cfg)` → `await e.reply("仅主人可用。")` 并 `return`（不泄漏任何列表）。
  3. `kind === "models"`：`arg` 为空 → `e.reply(formatModelList(cfg, state))`；否则 `applyModelSwitch` → 成功则 `saveState(nextState)`，回复 `result.message`。
  4. `kind === "endpoints"`：同上，用 `formatEndpointList` / `applyEndpointSwitch`。
  5. **整个函数体 try/catch**，catch 里 `await e.reply("AI 配置读取失败，请检查 data/aiChat/config.yaml")`。

---

## 5. 文件 3：`plugins/example/zzzAIChat.js`

```js
import plugin from "../../lib/plugins/plugin.js"
```

- 配置：`super({ name:"AI兜底对话", dsc:"@机器人 的普通消息交给 OpenAI 兼容接口", event:"message", priority:9998 })`
- 只重写 `async accept(e)`，**不写 rule**（避免和指令正则纠缠）。
- `accept` 流程（**整体 try/catch，异常只 `logger.error`，绝不 rethrow**）：

```
1. cfg = loadConfig(); decision = decideRoute(e, cfg)
2. decision.action === "hint_percent" → cfg.percentHint 为真才回 cfg.percentHintText，return "return"
3. decision.action === "hint_empty"  → 回 cfg.emptyHintText，return "return"
4. decision.action !== "ai" → return false
5. { endpoint, model } = resolveEndpoint(cfg, loadState())
   endpoint 为 null → 回 "还没有可用的模型接口，请先配置 data/aiChat/config.yaml"，return "return"
6. apiKey = endpoint.apiKeyEnv ? (process.env[endpoint.apiKeyEnv] || "") : ""
   apiKey 为空 → 回 "接口 <name> 未配置密钥（环境变量 <apiKeyEnv>）"，return "return"
7. 图片：遍历 e.img（最多 cfg.maxImages），逐张 fetch（AbortSignal.timeout(8000)），
   读 arrayBuffer，超过 cfg.maxImageBytes 或下载失败 → 跳过该图并 logger.warn；
   成功 → { mime: sniffMime(buf), dataUrl: "data:" + mime + ";base64," + Buffer.from(buf).toString("base64") }
8. { url, headers, body } = buildChatRequest(cfg, endpoint, model, text, images, apiKey)
   text 取 decideRoute 用的同一清洗文本（抽一个内部函数，或让 decideRoute 返回 text —— **推荐 decideRoute 额外返回 text 字段**，见第 3.3 节的补充）
9. fetch POST，超时 = endpoint.timeoutMs || cfg.timeoutMs
10. 非 2xx：401/403 → "接口鉴权失败，请检查密钥"；429 → "接口繁忙（429），稍后再试"；
    其它 → "模型调用失败：" + res.status
11. content = trimReply(extractContent(json), cfg.maxReplyChars)；content 为空 → "模型没有返回内容。"
12. logger.mark("[AIChat] " + 通道 + " " + user_id + " " + model + " " + 耗时ms + "ms")
13. await e.reply(content) —— **仅一次，不加引用参数**
14. return "return"
```

> **补充（与 3.3 一致）**：`decideRoute` 返回 `{ action, reason, text }`，`text` 为清洗后的文本，供第 8 步直接使用。

---

## 6. 文件 4：`plugins/example/zzzShortcuts.js` 只加两处

**改动 1**：文件顶部 import 区最后加一行：
```js
import { parseMasterCommand } from "./aiChatCore.mjs"
```

**改动 2**：`async accept(e) { if (!e.msg) return false; const msg = e.msg.trim()` **之后、规则 0（帮助）之前**插入：
```js
    // 0.0 主人专用：/模型、/模型列表、/模型接口（交给 AI 模块，避免落入"未识别指令"拦截）
    const masterCmd = parseMasterCommand(msg)
    if (masterCmd) {
      try {
        const { handleMasterCommand } = await import("./aiChatControl.mjs")
        await handleMasterCommand(e, masterCmd.kind, masterCmd.arg)
      } catch (err) {
        logger.error("[AI] 主命令处理失败", err)
        await e.reply("AI 模块未就绪，请检查 data/aiChat/config.yaml")
      }
      return "return"
    }
```

**其它一行都不要动**：原有帮助映射、裸词映射、未识别斜杠拦截、`isSlashInput` 全部保持原样。

---

## 7. 文件 5：`config/aiChat.yaml`

照抄下面内容（占位值即可，**不得写入任何真实密钥**）：

```yaml
# AI 兜底对话配置（部署到 /root/Yunzai/data/aiChat/config.yaml）
# 密钥一律走环境变量，本文件只写变量名
enabled: true
allowPrivate: false
percentHint: true
groupWhitelist: []
masterUserIds: []
maxInputChars: 2000
maxImages: 4
maxReplyChars: 1800
timeoutMs: 45000
endpoints:
  - name: "local"
    baseURL: "http://host.docker.internal:1234/v1"
    apiKeyEnv: "AICHAT_KEY_LOCAL"
    supportsVision: true
    models: ["qwen2.5-vl-7b-instruct"]
    defaultModel: "qwen2.5-vl-7b-instruct"
  - name: "cloud"
    baseURL: "https://api.deepseek.com/v1"
    apiKeyEnv: "AICHAT_KEY_CLOUD"
    supportsVision: false
    models: ["deepseek-chat"]
    defaultModel: "deepseek-chat"
```

## 8. 文件 6：env 透传

`.env.example` 末尾追加：
```
# AI 兜底对话：各接口密钥（变量名必须与 config/aiChat.yaml 的 apiKeyEnv 一致）
AICHAT_KEY_LOCAL=
AICHAT_KEY_CLOUD=
```
三个 compose 文件的 `environment:` 段各追加：
```yaml
      AICHAT_KEY_LOCAL: ${AICHAT_KEY_LOCAL:-}
      AICHAT_KEY_CLOUD: ${AICHAT_KEY_CLOUD:-}
```

---

## 9. 禁止项（违反即返工）

1. 不许改 `tests/`、`README.md`、`plugins/ZZZ-Plugin/`、`patches/`、`resources/`。
2. 不许新增 npm 依赖、不许改 `package.json`、不许联网（除运行时调用模型接口）。
3. 不许写任何真实密钥/token；不许把 `apiKey` 写进日志、回复或 `state.json`。
4. 不许一次回复多条消息；不许流式；不许加对话历史。
5. 不许在 `accept` 里 `throw`；不许用 `process.exit`。
6. 不许改动 `zzzShortcuts.js` 里除第 6 节两处以外的任何字符（包括注释与空行）。
7. 不许用 `console.log`，日志统一 `logger.*`。

---

## 10. 验收（你必须自己跑，并把输出贴进报告）

> **本机环境有两个硬坑，照下面的写法抄：**
> 1. `node --test` 在本沙箱会以 `spawn EPERM` 失败（子进程被禁止）——**不要用 `--test`**，直接运行测试文件，node:test 会在进程内执行并仍然返回正确退出码。
> 2. PowerShell 里对 `node` 使用 `2>&1`、`*>` 重定向会报 `StandardOutputEncoding` 错误——**不要重定向**，直接让它输出。

```powershell
cd C:\Library\repository\zzz-Bot
node tests/ai-chat-core.test.mjs
node --check plugins/example/aiChatCore.mjs
node --check plugins/example/aiChatControl.mjs
node --check plugins/example/zzzAIChat.js
node --check plugins/example/zzzShortcuts.js
```

- 测试文件**已由上游写好**，是唯一验收标准：**必须 0 fail**。测试失败时**改实现，不许改测试**。
- 若某条测试与本文档冲突，**以测试为准**并在报告中指出冲突点。
- 注意：`aiChatCore` 的扩展名**必须是 `.mjs`**，否则本机没有 `package.json` 的 `type:module` 会把它当 CommonJS 而无法被测试 import。

---

## 11. 交付报告格式（照抄结构）

```
## 变更文件
- <路径>：<做了什么，几行>

## 验收输出
<node tests/ai-chat-core.test.mjs 的尾部 10 行 + 4 条 node --check 的结果>

## 偏离说明
<与规格不一致之处；没有就写"无">

## 已知未覆盖
<你没验证到的部分；没有就写"无">
```
