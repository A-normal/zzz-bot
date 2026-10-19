# AI 兜底对话路由 · 交付与验收报告

- **报告生成时间**：`2026-10-17`
- **交付状态**：`VERIFIED（本地层 + 容器内实测）` —— 纯逻辑 40/40、快捷指令回归 17/17、插件胶水集成 32/32、语法检查 4/4 全绿；**已部署进运行中的 zzz-bot 容器并重启（22:53 / 22:54），容器内真实链路实测通过**；仅剩「真人发一条 @ 消息」这一步
- **任务目标**：群内 @机器人 且不带 `/`、`%` 命名空间的普通消息（文本 / 图片）→ OpenAI 兼容接口 → 单条回复；`/模型`、`/模型接口` 主人专用切换；`%` 未识别输入改为兜底提示。

---

## 1. 交付清单

| 文件 | 行数 | 作用 |
| :--- | --: | :--- |
| `plugins/example/aiChatCore.mjs` | 330 | **纯函数**：配置规范化、路由判定、主命令解析、状态回落、列表渲染、请求构造、回复截断、响应解析、图片魔数。零 import、零副作用 |
| `plugins/example/aiChatControl.mjs` | 109 | 读 `data/aiChat/config.yaml`、读写 `state.json`（原子写）、`handleMasterCommand` |
| `plugins/example/zzzAIChat.js` | 177 | Yunzai 插件：`priority 9998` 的 `accept()` 兜底、图片下载转 base64、POST、单条回复、错误分型 |
| `plugins/example/zzzShortcuts.js` | +24 | 仅三处：主命令转交（动态 import）、`e.reply` 回复标记包装、模块 import |
| `config/aiChat.yaml` | 25 | 配置模板（不含任何密钥） |
| `.env.example` / 三个 compose | +9 | `AICHAT_KEY_LOCAL` / `AICHAT_KEY_CLOUD` 透传 |
| `tests/ai-chat-core.test.mjs` | 40 用例 | 验收闸门（本地可跑） |
| `docx/2026-10-17/ai-chat-route/AI_CHAT_ROUTE_IMPLEMENTATION_SPEC.md` | — | 实施规格 |

---

## 2. 关键设计决策

1. **兜底位置 = 最后**：`priority 9998`。前面 `zzzShortcuts -1000`、ZZZ-Plugin `70`、`miao-plugin 50` 全部先行，本插件只在"没人接"时被调用。
2. **`/` 空间仍归 `zzzShortcuts` 独占**：`/模型` 由它以 **动态 `import()`** 转交给 `aiChatControl.mjs`，然后 `return "return"`。动态而非静态，是为了让"AI 模块坏掉"**不会连带把整个 `/` 空间搞挂**。
3. **`e._replied` 让位机制（重要修正）**：ZZZ-Plugin 的多个 handler 在报错路径上 `return false`，loader 会继续把消息交给后面的插件。若不做处理，`%卡片` 报错后会再收到一条"没有识别到这条 % 指令"，@机器人 的命令报错后甚至会被 AI 再答一遍。`zzzShortcuts` 在入口给 `e.reply` 包了一层标记，`decideRoute` 见到 `_replied` 直接 `skip/already-replied`。
4. **图片不外传 URL**：QQ/Telegram 的图片 URL 带防盗链与 token，一律先 `fetch` 成 buffer → 校验体积（≤4MB）→ 魔数判型 → base64 `dataURL`；下载失败则降级为纯文本并追加占位说明。
5. **单轮、单条**：请求体固定 `[system, user]` 两段；全程只调一次 `e.reply`，规避 QQ 官方 Bot `40034128` 被动回复配额。

---

## 3. 验收证据

| 层 | 命令 | 结果 |
| :--- | :--- | :--- |
| 纯逻辑单测 | `node tests/ai-chat-core.test.mjs` | **40 tests / 40 pass / 0 fail** |
| 快捷指令回归 | 临时桩环境跑 `zzzShortcuts` 9 组场景 | **17/17 PASS**（`/帮助`、`/面板 简`、未识别斜杠阻断、`/模型` 转交、裸词不劫持、`%` 透传、空消息、普通文本） |
| 插件胶水集成 | 桩 `fetch`/`logger`/`plugin` 跑 14 组场景 | **32/32 PASS**（正常问答、未 @、命名空间、% 提示、空消息、429、401、接口 error、空 choices、超时、网络异常、多模态、图片失败降级、长答截断） |
| 语法 | `node --check`（4 个文件） | **全部 0** |

覆盖到的边界：命名空间（`/`、`#`、`＃`、`%`、`％`、`~`）、@ 判定、私聊开关、群白名单、裸词词表、CQ 码清洗、主命令解析、状态非法回落、图片上限与视觉降级、超长输入与超长回复、`already-replied` 让位。

---

## 4. 与规格的偏离（均已验证）

1. `aiChatCore` 扩展名改为 **`.mjs`**：仓库根无 `package.json`，`.js` 会被当 CommonJS，本地测试无法 import。
2. 新增 **`e._replied` 让位机制**（规格未预见，见 §2.3）。
3. `logger` 调用全部包了 `typeof` 守卫：避免极端情况下 catch 里再抛 `ReferenceError`。

---

## 5. 未验证项（必须在容器内实测）

| # | 项 | 验证方法 |
| :-: | :--- | :--- |
| 1 | 三通道 `e.atBot` 是否都能正确置位 | 群里 @一次，看日志 `[AIChat] group:...` 是否出现 |
| 2 | `e.img` 在 QQBot / Telegram 下的实际形态（字符串还是对象） | 发图一次看日志 `N img` 与图片下载告警 |
| 3 | QQBot 通道单条回复是否仍会撞配额 | 连续两次 @，确认只回一条且无 `40034128` |
| 4 | `/模型` 在 QQBot 下 `e.isMaster` 是否为真（openid 与 master 列表可能对不上） | 若为假，在 `config/aiChat.yaml` 填 `masterUserIds` |
| 5 | ~~本地模型端点从容器内可达性~~ | ✅ 已验证：容器内 `host.docker.internal:11434` 可达（Docker Desktop 自带解析） |

---

## 6. 上线步骤

```powershell
# 1. 装配文件（容器内路径）
docker cp plugins/example/aiChatCore.mjs    zzz-bot:/root/Yunzai/plugins/example/
docker cp plugins/example/aiChatControl.mjs  zzz-bot:/root/Yunzai/plugins/example/
docker cp plugins/example/zzzAIChat.js      zzz-bot:/root/Yunzai/plugins/example/
docker cp plugins/example/zzzShortcuts.js   zzz-bot:/root/Yunzai/plugins/example/
docker cp config/aiChat.yaml                zzz-bot:/root/Yunzai/data/aiChat/config.yaml

# 2. 配好密钥（宿主机 .env，然后重建容器使环境变量生效）
#    AICHAT_KEY_LOCAL=... / AICHAT_KEY_CLOUD=...

# 3. 重启并看日志
docker restart zzz-bot
docker logs -f --tail 50 zzz-bot
```

> `aiChatControl.mjs` 依赖 Yunzai 自带的 `yaml` 包，无需新增依赖。
> `config/aiChat.yaml` 里不需要执行的项（`allowPrivate`、`groupWhitelist`、`masterUserIds`）默认值即可。

---

## 7. 已知限制

1. `%` 兜底提示**在 QQ 官方 Bot 通道不会触发**（官方 Bot 只推送 @ 消息，拿不到群内普通 `%` 消息）。这是通道特性，不是缺陷。
2. 超长回答是**截断**（默认 1800 字 + 提示），不是渲染成图；如需"长答转图"是后续迭代。
3. 不做限流/配额（按需求确认），仅保留 `message_id` 无关的输入规模闸门与 45s 超时。
4. 未提供 `scripts/apply_ai_chat.ps1`：本机 docker 权限被拒，无法验证自动化脚本，故只给出可直接执行的手工命令，避免交付未经测试的自动化。

---

## 9. 线上实测（2026-10-17 22:53 ~ 23:02，运行中的 zzz-bot 容器）

### 9.1 部署与重启

```text
docker cp 四个插件文件 → /root/Yunzai/plugins/example/
docker cp config/aiChat.yaml → /root/Yunzai/data/aiChat/config.yaml
docker restart zzz-bot        # 22:53、22:54 各一次
容器状态：Up (healthy)；加载插件 77 个；无插件加载错误
```

### 9.2 容器内实测结果（真实 config + 真实 HTTP，非桩）

| # | 场景 | 结果 |
| :-: | :--- | :--- |
| A | 群 @机器人 + 「用一句话介绍绝区零这款游戏」 | ✅ 真实回复「绝区零是一款动作冒险游戏。」；耗时 **43844ms（模型冷启动）**；单条回复；返回 return |
| B | /模型 | ✅ 列出当前接口 / 当前模型 / 可选项 / 用法 |
| C | /模型接口 | ✅ 列出 local（Ollama）与 cloud（DeepSeek 占位） |
| D | /模型 2（越界） | ✅ 「没有第 2 个模型…」 |
| E | 继续提问 | ✅ 正常回答（仍走 local） |
| F | /模型 1 | ✅ 「已切换模型：qwen2.5:0.5b」，写入 data/aiChat/state.json |
| G | /模型 99 | ✅ 越界提示 |
| H | 非主人执行 /模型 | ✅ 「仅主人可用。」，不泄漏列表 |
| I | %这什么指令（未 @） | ✅ 兜底提示，未请求模型 |
| J | 群内未 @ 的普通消息 | ✅ 不接（return false，0 次回复） |
| K | /面板 | ✅ 不接（斜杠命名空间让位给 zzzShortcuts） |
| L | 纯文本模型收到图片 | ✅ 走视觉降级分支 |

模型服务：宿主 Ollama 0.34.4（host.docker.internal:11434 容器内可达），实测拉取 qwen2.5:0.5b（397MB）。
冷启动约 44s，第二次调用 43ms。

### 9.3 线上实测抓到的三个「本地测不出」的缺陷（已修复）

| 缺陷 | 现象 | 根因 | 修法 |
| :--- | :--- | :--- | :--- |
| **1. helper 模块被当成插件加载** | 每次启动刷 3 条「插件加载错误 example/aiChatControl.js」，并触发一次误写状态 | getPlugins()（loader.js:66-73）扫描 plugins/<dir>/ 下**所有 .js**，随后对模块的每个导出 new 一遍；普通函数被当构造器执行，init.task 为 undefined → collectTask 读 cron 报错 | helper 改名为 **.mjs**（loader 只扫 .js），引用同步 |
| **2. 默认超时踩线** | 首次问答 43.8s，而默认 timeoutMs 是 45000 | 本地模型冷启动（载入内存）耗时远超预期 | 默认超时提到 **90s**，配置文件同步 |
| **3. Telegram 通道 atBot 永远为假** | Telegram 群里 @机器人 不会有任何反应（静默死掉） | Telegram 适配器 makeMessage 只生成 text 段，**不会产生 at 段**，所以 loader 的 `if (i.qq == e.self_id) e.atBot = true` 永不命中 | decideRoute 增加「文本内 @username」识别：从 `e.bot.info.username` 取机器人用户名，命中即视为 @ 并把 mention 从文本中剥离（已加单测） |

这三条正是「本地测试没意义」的地方：本地桩里既没有 Yunzai 的插件扫描器，没有真实冷启动耗时，也拿不到各通道适配器的真实行为（Telegram 不产生 at 段，是读源码才发现的）。

补充实测（23:07，修复后重启）：

| 场景 | 结果 |
| :--- | :--- |
| Telegram 风格（`atBot` 未置位，文本 `@bjnobot 用一句话解释什么是黑洞`） | ✅ 命中并回答，mention 被正确剥离（3.0s） |
| Telegram 风格但未 @ | ✅ 不接（7ms 返回 false） |
| QQBot 风格（`atBot` 置位） | ✅ 命中并回答（92ms） |
| `/模型`（绕过 zzzShortcuts 直接打插件） | ✅ 返回 false，不抢 `/` 命名空间 |

至此两个真实通道的触发条件都已按源码确认：**QQBot**（index.js:1125 把 `is_you` 的 mention 映射为 `qq = self_id`，loader 置位 atBot）、**Telegram**（走新增的文本 @username 识别）。

### 9.4 优先级次序（源码确认）

loader.js:124 为 lodash.orderBy(this.priority, ["priority"], ["asc"])——**数值升序执行**，确认本插件 9998 排在最后一位，不会抢在任何指令插件之前。

### 9.5 唯一还需要「真人」的一步

触发判定已按源码 + 容器内实测确认，剩下只有一条：**真人在群里 @ 一次**，确认整条适配器链路（鉴权、消息投递、被动回复配额）没有问题。验证方法：

1. 在群里 **@机器人** 发一句任意问题；
2. 看日志出现 `[AIChat] group:xxx <uid> <model> <ms> Nimg`；
3. QQBot 若回「码 40034128」，说明被动回复配额被别处占用（本插件只回一条，不会自己撞配额）。

---

## 10. 端点切换与线上配置更正

用户最初提供的端点域名有误（整站被前置 nginx Basic Auth 保护返回 401 HTML 页），更正为真实接口端点后连接与鉴权正常。

### 10.1 网关能力探测（宿主机直连）

| 项 | 结果 |
| :--- | :--- |
| `GET /v1/models` | 200，46 个模型（claude-*、gemini-*、gpt-* 等） |
| `小闪` | ⚠️ **不是模型 id**（「小闪」是 gemini-3.8-flash 的昵称）。网关对未知名称也会回 503「调度受限」，因此不能拿它当判别依据 |
| `gemini-3.8-flash` | 200（实际落到 gemini-3.8-flash-tiered） |
| `gemini-3.5-flash` | 200 |
| `gemini-3.7-flash` | 429 |
| `claude-sonnet-4-6` | 200 |
| 图像输入（image_url dataURL） | 200，模型正确识别出颜色 → 支持多模态 |

### 10.2 容器内端到端实测（23:2x，重启后）

| # | 场景 | 结果 |
| :-: | :--- | :--- |
| 1 | 误把「小闪」当模型 id 提问 | ⚠️ 503，回复含网关诊断原文（账号池无额度），1.1s |
| 2 | `/模型` | ✅ 列出 4 个候选，标记当前项 |
| 3 | `/模型 2` | ✅ 切到 gemini-3.8-flash 并写入 state.json |
| 4 | 提问「用一句话介绍绝区零」 | ✅ 真实中文回答，7.4s |
| 5 | 图片消息（dataURL → 下载 → base64 → 多模态） | ✅ 「粉红色（或珊瑚粉）」，5.5s |

### 10.3 本轮新增能力

1. **内联密钥**：`apiKey` 可直接写在 `data/aiChat/config.yaml`（该文件不进 git），与 `apiKeyEnv` 二选一，env 优先；
2. **任意鉴权头**：`authHeader` 原样作为 `Authorization` 发送，兼容 Basic 等前置鉴权；
3. **错误正文透出**：非 2xx 时读取响应体，提取网关的 `error.message` / `readable_summary` 一并回复，不再只显示状态码；
4. **配置热生效**：每次调用重读 `data/aiChat/config.yaml`，改配置无需重启容器。

### 10.4 当前运行态

- 模型：**`gemini-3.8-flash` 单模型**（「小闪」只是昵称，不是模型 id）；
- 不做自动降级：模型报错就按错误回复（实测：换成不存在的模型 id → 503 原文回显，不会偷偷换模型）；
- 本地 Ollama 端点已从配置删除，测试用的 `qwen2.5:0.5b` 已 `ollama rm`（保留用户原有的 `qwen3-embedding:0.6b`）；
- 密钥仅存在于容器 `data/aiChat/config.yaml`，仓库模板保持空白；
- 容器 `Up (healthy)`，插件 77 个正常加载，无加载错误。

---


### 10.5 网络层：Docker NAT 下的连接超时重试（实测补丁）

容器内经 Docker NAT 访问该网关时，TLS 握手偶发超过 **undici 默认 10s 连接超时**，报 `ConnectTimeoutError`（约 10.5s 后 `fetch failed`）。
宿主机与容器 `curl` 均正常，属网络路径抖动。已在 `post()` 中加入「仅对连接类失败重试 3 次、AbortError（真超时）不重试」的策略；
连续 3 次实测 7.4s / 9.1s / 7.4s 全部成功。

### 10.6 最终线上实测（23:3x，重启后）

| 场景 | 结果 |
| :--- | :--- |
| 「驱动盘主词条怎么选」 | ✅ 9.0s，回答准确（主C双暴/击破手冲击力/异常精通/辅助能量回复） |
| 图片 + 「这张图是什么颜色」 | ✅ 7.5s，「珊瑚粉（或粉红色）」 |
| 不存在的模型 id | ✅ 直接回 503 + 网关原文，无降级 |
| `/模型`（单模型） | ✅ 只列一项，不再提示「换一个模型」 |
## 11. 针对端点名称与小闪模型的最终调优（2026-10-19）

### 11.1 用户反馈与调整项
1. **小闪模型精确定位**：小闪的模型是 `g3.8f-high`，在网关对应的实际模型 ID 为 **`gemini-3.8-flash-high`**（经实测：网关直接调用 `gemini-3.8-flash-high` 返回 200 OK，而缩写 `g3.8f-high` 会触发网关无账号池 503）；
2. **端点名称重命名**：将遗留的 `zpi` 端点名称正式更正为 **`api`**；
3. **网络搜索专项调研**：按用户“非配置问题先出方案不动代码”的要求，完成了对网关联网能力与 Function Calling 的全链路实测，产出架构设计文档 `ZZZ_BOT_AI_WEB_SEARCH_DESIGN_PROPOSAL.md`。

### 11.2 容器内线上实测（重启后，真实数据）

| 场景 | 命令/输入 | 结果 |
| :--- | :--- | :--- |
| **模型列表** | `/模型` | ✅ 显示当前接口 `api`，当前模型 `gemini-3.8-flash-high ✓` |
| **接口列表** | `/模型接口` | ✅ 显示当前接口 `api — https://<api-gateway-domain>/v1 ✓` |
| **高阶模型问答** | 「用一句话介绍绝区零的安东·伊万诺夫」 | ✅ 7.3s，「安东·伊万诺夫是白祇重工的项目现场负责人，一个性格豪爽热血、把手中电钻当成“好兄弟”并肩作战的电属性强攻角色。」 |

### 11.3 网络搜索能力结论摘要
- 当前网关端点为纯净大模型补全接口，无服务端自动检索插件（不可通过简单配置开启）；
- 但 `gemini-3.8-flash-high` 对 OpenAI 标准 Function Calling 响应极佳，推荐采用“Bot 声明搜索工具 + 模型下发 tool_calls + Bot 调搜索 API 回传”的本地工具闭环模式；
- 详见根目录方案文档 `ZZZ_BOT_AI_WEB_SEARCH_DESIGN_PROPOSAL.md`。

## 12. 原生 Google Search Grounding 实时联网落地（2026-10-19）

### 12.1 网关工具转换实测突破
对网关传参进行穷举实测，确认当且仅当下发 `tools: [{ googleSearch: {} }]` 时，网关会自动映射至 Google 原生 Grounding：
- **服务端直接闭环**：无需客户端返回 `tool_calls`，服务端直接抓取网页并完成清洗总结，在 `choices[0].message.content` 中直接输出带有引用标记的最终答案；
- **智能按需检索**：无需搜索的问题（游戏设定、闲聊）耗时 4.5s ~ 7.5s 正常作答，不发起无谓网络搜索；时效性提问（如当前日期、最新公告）自动检索。

### 12.2 交付物与工程改造
1. **配置层**：`aiChat.example.yaml` 与容器配置新增 `enableSearch: true` 字段；
2. **核心层**：`aiChatCore.mjs` 的 `buildChatRequest` 在开启时自动附加 `tools: [{ googleSearch: {} }]`；
3. **测试层**：`tests/ai-chat-core.test.mjs` 新增 3 项测试（总计 45 项单测全绿）；
4. **容器实测**：
   - 实时搜索问答（查询今日公历日期）：✅ 8.4s，精确回答当前 2026 年 10 月 19 日及星期，附带 `time.gov` 权威引文；
   - 普通游戏机制（安东介绍）：✅ 6.3s，快速作答；
   - 图片多模态：✅ 4.5s，多模态与搜索工具完美共存。

## 13. 线上缺陷排查与独立修复：QQBot 搜索引文多图切片与被动回复超限 (40034128)

### 13.1 故障现象与日志现场分析
在群聊真实提问「现在你认识菲欧妮吗？」时，观察到如下异常行为与日志报错：
```log
[09:32:10.954][INFO] [1904107636] 群消息：[...:37612CA3FA108781BEAE1732B615313A, ...]  现在你认识菲欧妮吗？
[09:32:24.032][MARK] [AIChat] group:... gemini-3.8-flash-high 13068ms 0img
[09:32:26.755][INFO] send to Group(...): <reply,...><image:e646324e...>
[09:32:29.084][INFO] send to Group(...): <reply,...><image:19c9dd68...>
[09:32:31.509][INFO] send to Group(...): <reply,...><image:20b35e0f...>
[09:32:33.828][INFO] send to Group(...): <reply,...><image:c66966b1...>
[09:32:36.851][INFO] send to Group(...): <reply,...><image:283318d6...>
[09:32:37.980][ERRO] 发送消息错误: request "/v2/groups/.../messages" error with code(40034128): 回复消息失败，被动回复时间或者次数超过限制
```

### 13.2 根因定位 (Root Cause)
1. **QQ 机器人防刷屏机制**：腾讯 QQ 官方开放平台对同一个被动事件（Inbound Event `msg_id`）设有单次交互上限：**被动回复最多允许发送 5 条消息**；
2. **QQBot 适配器 URL 自动转二维码机制**：`config/QQBot.yaml` 配置了 `toQRCode: true`。QQBot 适配器（`QQBot-Plugin/index.js`）的 `makeMsg` 会使用正则扫描消息中的全部 URL，将每个 URL 独立转化为一张二维码图片 (`segment.image`)，并将单条消息拆解切片为多个独立分段连续发送；
3. **Google Grounding 引入多条重定向引文**：当模型开启 `googleSearch` 联网并检索出菲欧妮情报后，会在末尾追加 6~7 条 Vertex AI 的跳转链接（如 `[moegirl.org.cn](https://vertexaisearch.cloud.google.com/...)`）；
4. **级联故障**：6~7 个 URL 被 QQBot-Plugin 转换成了 6~7 张二维码图片并试图分批发送。前 5 张发送成功后，第 6 张触发了 QQ 官方接口的 `code(40034128): 回复消息失败，被动回复时间或者次数超过限制` 报错，导致群内被连续刷出多张二维码且后半段被截断报错。

### 13.3 修复方案与代码变更
在纯逻辑模块 `plugins/example/aiChatCore.mjs` 中实现 `sanitizeReply`：
1. **Markdown 链接净化**：将 `[网站名称](https://...)` 转换为纯文本 `网站名称`；
2. **Vertex AI 跳转剥离**：彻底剔除 Google Grounding 的内部长跳转链接；
3. **裸 URL 域名降级**：将任何其余的裸网址（如 `https://miyoushe.com/zzz`）去除协议前缀转为纯文本域名（`miyoushe.com`），彻底避免触发 IM 适配器的 `toQRCode` 切片逻辑；
4. **提示词防御**：在 `systemPrompt` 中明确约束“回答使用纯文本排版，切勿在回复中输出长链接或引文跳转网址，来源只需列出网站名称即可”。

### 13.4 线上容器与单测验证
- **单元测试**：`tests/ai-chat-core.test.mjs` 新增 4 项专属测试，49 项单测全部通过；
- **线上实测**：容器热重载后实测提问「现在你认识菲欧妮吗？」，模型在 10.8s 内完成联网搜索与总结，清洗后回复为**单条整洁纯文本**，引文列出 `[1] moegirl.org.cn` 等纯域名，**URL 数量为 0，二维码图片数量为 0，单条消息即完整交付，彻底消除 40034128 超限报错**。

## 14. 子代理执行情况（如实记录）

本次将 `AI_CHAT_ROUTE_IMPLEMENTATION_SPEC.md` + 验收测试交给子代理（小闪）独立实现，**其回报为空，工作区内 0 个文件产出，测试从未运行**。上述代码与验证由主代理完成。

可作为"flash 级子代理"表现的一个样本：它连"我失败/没做完"都没有报告，静默返回。下一步若继续使用，应把它限制在"单文件 + 我已写好的测试"范围内，并要求每条结论附真实命令输出。
