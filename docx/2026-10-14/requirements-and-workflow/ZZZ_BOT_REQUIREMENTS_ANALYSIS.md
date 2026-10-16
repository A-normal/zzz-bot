# ZZZ-Bot 四大需求可行性与稳定性分析报告

> **性质**：只读分析。本报告未修改任何代码、文件、配置或服务。
> **证据来源**：容器内实际代码/配置 + 上游仓库公开文档。
> **分析基线**：稳定性优先 ＞ 功能丰富度；非破坏性更新；**完全拒绝远程脚本/远程指令**；**游戏数据本地化**。

---

## 0. 判定基线与全局约束

### 0.1 数据本地化的三层判定标准

判定一个功能是否满足"数据本地化"，必须区分**数据源**与**数据落点**：

| 层级 | 类别 | 判定 | 说明 |
| :--- | :--- | :---: | :--- |
| L1 | **官方游戏 API**（miHoYo / HoyoLab / Kuro） | ✅ 允许 | 这是游戏数据的唯一权威源，本地 Bot 直连官方即为"本地化" |
| L2 | **本地渲染 / 本地 DB**（Puppeteer + `data/db`） | ✅ 允许 | 已有能力，数据落盘在本机 |
| L3 | **第三方聚合后端**（账号注册、api_key、数据上传） | ❌ 禁止 | 违反约束：数据落到他人服务器 |
| L4 | **远程脚本 / 远程指令执行** | ❌ 禁止 | 已在本项目 Phase 4 中明确物理隔离 |

**当前项目已存在的第三方只读依赖（需知悉，非本次改动项）**：

| 依赖 | 用途 | 位置 | 性质 |
| :--- | :--- | :--- | :--- |
| `https://enka.network/api/zzz/uid/` | 绝区零展柜面板 | `ZZZ-Plugin/config/config.yaml` 的 `enkaApi` | L3 只读查询（不上传凭据，仅按 UID 拉取） |
| MiniGG-Api | 原神面板旁路 | 运行日志 `面板服务：MiniGG-Api` | L3 只读查询 |
| `ghproxy.mihomo.me/.../get_device_info...apk` | 设备指纹 APK 下载 | `ZZZ-Plugin/config/config.yaml` 的 `url` | ⚠️ 远程可执行资源，**建议后续评估是否本地化** |

> **结论**：L1/L2 是"本地化"，L3 的**只读按 UID 查询**可接受但需知悉；**L3 的"注册账号+上传+api_key"模式绝对不可接受**——这直接决定需求 4 的结论。

---

## 需求 1：绝区零米游社自动签到

### 1.1 现状（已证实）

**全插件树检索 `签到` 关键字**，结果：

| 文件 | 命中性质 |
| :--- | :--- |
| `genshin/apps/mysNews.js:123` | `if (/签到/g.test(this.e.msg)) return false` — **排除**签到帖，非功能 |
| `genshin/model/user.js`、`model/mys/mysInfo.js` | 注释/字段提及，非功能 |
| `miao-plugin/apps/wiki/CalendarZZZ.js:15` | 正则过滤"签到福利"活动，**排除**项 |
| `miao-plugin/config/help_*.js` | 帮助文案 |

**结论**：当前项目**不存在任何可用的米游社签到实现**。ZZZ-Plugin 明确将自身定位为"数据查询/面板"插件，不含签到。

### 1.2 可行性

**可行性：高**，但有一个必须实测确认的前提。

- 米游社社区签到走官方 API（L1），符合本地化约束；
- 凭据可直接复用已落地的 `NoteUser`（`Yunzai-genshin` 的 Cookie/Stoken 体系），无需新增登录流程；
- 签到为**单次低频率**请求（每日 1 次），对现有面板查询链路压力极小。

**唯一未知项**：绝区零米游社签到的 `act_id` 与接口路径**必须实测确认**，不能照搬原神/星铁的参数。此项属于"必须有日志证据才能定论"的部分。

### 1.3 实现目标与结果

| 目标 | 设计结果 |
| :--- | :--- |
| **独立配置，不影响角色数据获取** | 独立插件目录 + 独立 `config.yaml`；**只读**复用 Cookie，**绝不改写**面板缓存/设备指纹；签到与面板请求互斥调度，避免并发 |
| **指定范围内随机时间模拟签到** | 配置 `windowStart` / `windowEnd`（如 06:00–23:00）+ `jitterMinutes`；每日在窗口内随机取一个时刻执行，规避固定时刻风控 |
| **支持单次签到** | 手动指令（如 `%zzz签到`）立即执行一次 |
| **支持长期自动签到** | 云崽原生 `task`（cron）注册，每日触发；按用户/UID 维度开关 |
| **Cookie 过期强提示** | 命中风控/未登录返回码时，向绑定者私聊 + 群内 @ 双通道推送醒目告警，并在状态中标记"凭据失效"，直到重新登录才清除 |

### 1.4 影响范围分析

| 影响面 | 风险 | 非破坏性保障 |
| :--- | :--- | :--- |
| 现有 `%面板` / `%便签` 链路 | **中** — 同一 Cookie 上叠加签到请求，理论上可能抬升风控概率 | 随机时刻 + 每日仅 1 次 + 与面板请求错峰；**不改动 ZZZ-Plugin 任何代码** |
| Cookie/Stoken 存储 | 低 | 只读复用，不新增凭据副本，不落盘明文日志 |
| 上游更新 | **零** | 独立插件目录，`git pull` 不会冲突 |
| 本地化合规 | ✅ | 仅调官方 API，数据落本地 DB |

### 1.5 结论

**建议实施**。这是四个需求中**业务价值最高、对现有功能侵入最小**的一项。落地前需先做一次**接口实测**（用现有凭据发一次签到请求，抓取真实 `act_id` 与返回码），拿到日志后再定稿。

---

## 需求 2：绝区零"全角色面板"

### 2.1 差异根因（已证实，且结论可能超预期）

**面板当前数据链路**（`apps/panel.js`）：

```
apps/panel.js
  ├─ import { ... } from '../lib/avatar.js'
  ├─ import { parsePlayerInfo, refreshPanelFromEnka } from '../model/Enka/enkaApi.js'
  ├─ refreshPanelFromEnka(uid)   →  https://enka.network/api/zzz/uid/   【仅展柜】
  └─ refreshPanel(api, deviceFp) →  米游社 zzzUser                        【仅展柜】
```

**Enka 与米游社 `zzzUser`（角色详情）返回的都只是游戏内"展柜"展示的角色**，这就是"只读到展柜角色"的根因。

**决定性发现**：`lib/avatar.js` 中**已存在完整角色列表能力**，但从未被调用：

```javascript
// lib/avatar.js —— 已导出
export async function getAvatarBasicList(api, deviceFp, origin = false) {
  const avatarBaseListData = await api.getFinalData('zzzAvatarList', { deviceFp })
  ...
  return result            // ← 返回账号下【全部角色】
}

export async function getAvatarInfoList(api, deviceFp, origin = false) {
  // 遍历全部角色，逐个调 zzzAvatarInfo({ id_list: [item.id] })
  // 带 roleInterval(3000ms) 限速
}
```

**交叉验证调用点**（全 `dist/` 检索 `avatar.js` 引用）：

| 引用文件 | 导入的成员 |
| :--- | :--- |
| `apps/panel.js` | `mergePanel, getPanelList, refreshPanel, getPanelOrigin, updatePanelData, formatPanelData, getPanelListOrigin` |
| `apps/damage.js` | `getPanelOrigin, formatPanelData` |
| `model/index.js`、`model/avatar.js` | `ZZZAvatarBasic` |

**`getAvatarBasicList` 与 `getAvatarInfoList` 在全部应用中零调用点。**

### 2.2 可行性

**可行性：高（属"接线"而非"开发"）**。

- 所需 API（`zzzAvatarList` / `zzzAvatarInfo`）**已在代码中存在**，无需新增远程依赖；
- 需要的凭据已具备（`#miao` 的 `mysUser.getMysUser('zzz')` → ck/ltuid/device）；
- 渲染管线现成（`this.render(...)` + 本地 Puppeteer）；
- 数据落点本地（`lib/db.js` 的 `savePanelData`）。

### 2.3 实现目标与结果

| 目标 | 设计结果 |
| :--- | :--- |
| 全角色面板 | 新增**独立指令**（如 `%全角色面板` / `%全角色刷新`），调用现有 `getAvatarInfoList` 拉取全部角色，写入本地 DB 并渲染 |
| **不影响展柜面板** | **完全新增命令，不修改 `%面板` / `%面板列表` 任何行为** |
| 风控友好 | 复用其内置 `roleInterval`（默认 3000ms）+ 队列串行 + 断点续拉（失败角色跳过而非整批失败） |
| 本地化 | 仅官方 API，落本地 DB |

### 2.4 影响范围分析

| 影响面 | 风险 | 说明 |
| :--- | :--- | :--- |
| 现有展柜面板 | **低** | 新命令独立，零改动既有路径 |
| **耗时与风控** | **中—高** | 全角色逐个拉取（约 40–60 角色 × 3s ≈ **2–3 分钟**），且 `zzzAvatarInfo` 属风控敏感接口，**存在触发 1034 极验的风险** |
| 本地存储 | 低 | 面板数据落本地 SQLite，体积可控 |
| 上游更新 | 低 | 若以独立插件实现则零冲突；若改 ZZZ-Plugin 源码需维护 patch（与 TRSS-Plugin 同模式） |

### 2.5 结论

**建议实施，但必须做成"手动触发的独立命令"**，不要默认自动全量拉取——否则 2–3 分钟的密集请求会显著抬升账号风控概率，反而威胁需求 1 的签到与既有面板功能。**稳定性优先级高于功能完整性**。

---

## 需求 3：彻底禁用原神、崩铁指令，释放命名空间

### 3.1 现状（已证实）

命令空间的供给方有两处：

| 供给方 | 内容 |
| :--- | :--- |
| `plugins/genshin`（Yunzai-genshin） | 用户绑定 `#绑定uid`、`#绝区零uid`、Cookie 绑定、体力、原神/星铁业务 |
| `plugins/miao-plugin` | `#面板…`、原神/星铁角色查询、排行、抽卡、wiki |

**已发现的命名空间冲突实例**（本次会话实证）：

- `/面板列表` → 内核 `dealText` 改写为 `#面板列表` → 被 **miao-plugin（原神）** 命中（`profile.js:20`）；
- `/绑定 <UID>` → `#绑定 <UID>` → 被 **genshin** 的 `bingUid` 命中。

这说明**命名空间确实已经被原神/星铁占用并造成实际误命中**。

**关键约束发现**：`plugins/genshin` **不能整体移除**——它同时承载了**绝区零的 UID 绑定与 OCR/`NoteUser` 凭据体系**（`#绝区零绑定UID`、`#绝区零uid`、`#扫码登录` 的落地依赖它）。因此"禁用原神/崩铁"必须是**选择性禁用**，而非删除插件。

### 3.2 可用机制（已证实）

**机制 A：云崽原生 `group.yaml` 的 `enable` / `disable`**（`config/config/group.yaml`）

```yaml
default:
  enable:        # 只启用功能，配置后只有该功能才响应
  disable:       # 禁用功能，功能名称,例如：十连、角色查询、体力查询、用户绑定、抽卡记录
    - 禁用示例
```

- 生效位置：`lib/plugins/loader.js:691 checkDisable()` —— `groupCfg.disable.includes(p.name)` → 该插件**完全不进入优先队列**（连 `accept()` 都不执行）；
- **写在 `default` 段即全局生效**，非单群；
- 非破坏性：**纯配置，随时可回滚**；
- 缺点：**按插件"名称"逐条列举**，原神/星铁相关插件名多达数十个，需逐一枚举。

**机制 B：目录级隔离**（本项目 Phase 4 已验证的成熟模式）

- 将 `plugins/miao-plugin` 等整体移出 `plugins/`（如 `plugins.disabled/`），loader 的 `getPlugins()` 按目录扫描，移出即不加载；
- **优点**：一次性彻底释放命名空间，且**完全可逆**（移回即恢复）；
- **缺点**：会同时失去 miao-plugin 为 **ZZZ-Plugin 提供的 `#miao` / `#miao.models` 依赖**（`ZEN` 面板与伤害计算链路依赖它）——**这是致命副作用，不可直接采用**。

> **重要提醒**：Phase 3 中 `Yunzai-genshin` 的 `base.js` 直接 `import "#miao"`。若移除 `miao-plugin`，genshin 与部分 ZZZ 能力将 `ERR_MODULE_NOT_FOUND`。**机制 B 对本项目不适用**。

### 3.3 推荐方案与影响范围

**推荐：机制 A（`group.yaml` 的 `default.disable`）为主，精确枚举**

| 影响面 | 风险 | 保障 |
| :--- | :--- | :--- |
| 绝区零既有功能 | **低** | 只禁用**原神/星铁专属**插件名，白名单保留 `用户绑定`、`绝区零…` 相关 |
| miao-plugin 依赖链 | **无** | 插件目录不动，`#miao` 依赖完好 |
| 上游更新 | **零** | 纯配置 |
| 回滚 | **零成本** | 删除该列表项即恢复 |

**执行前提**：需先**导出全部已加载插件名清单**（`this.priority` 中的 `name` 字段），再逐个筛选原神/星铁项——这一步必须实测枚举，不能凭猜。

### 3.4 结论

**可行且推荐，但必须"选择性禁用"**。要特别注意：`plugins/genshin` 是**绝区零凭据体系的承重墙**，绝不可整体移除。真正的风险不是技术难度，而是**枚举不准导致误禁绝区零功能**——因此必须先导出真实插件名清单再定稿。

---

## 需求 4：鸣潮 / 三角洲插件适配分析

### 4.1 鸣潮（Wuthering Waves）

**候选**：[erzaozi/waves-plugin](https://github.com/erzaozi/waves-plugin)（另有 [Xinglingsuiyue/waves-plugin](https://github.com/Xinglingsuiyue/waves-plugin) 分支、[TomyJan/Yunzai-Kuro-Plugin](https://deepwiki.com/TomyJan/Yunzai-Kuro-Plugin/3-user-guide)）

**数据链路（据其 README）**：
- 支持**手机验证码登录 / Token 登录**；
- 提供**本地化登录服务**（内置 Web 服务，默认 `127.0.0.1:25088`），文档专门给出"**部署本地化登录**"与"用 Cloudflare Tunnel 暴露本地服务"两种方案；
- 数据直连库街区（Kuro 官方 L1）。

**本地化合规判定：✅ 通过**

其架构是"**本地服务 + 直连官方 API**"，**没有第三方聚合后端**（不存在注册/api_key 模式）。登录服务跑在本地，凭据不出本机。

**适配评估**：

| 维度 | 结论 |
| :--- | :--- |
| 可行性 | 高。云崽插件标准形态，与本项目 `plugins/` + pnpm workspace 完全兼容 |
| 命令前缀 | `~`（如 `~登录`），与绝区零 `%`/`#`/`/` **无命名空间冲突** |
| 稳定性风险 | 中。需新开本地服务端口 `25088`，**与现有 `127.0.0.1:16677` 隔离策略需一并规划**（建议同样只绑 `127.0.0.1`） |
| 安全前置 | 必须按 Phase 4 模式做**静态审计**：核查是否含远程命令/文件操作模块 |
| 数据落点 | 本地 DB ✅ |

### 4.2 三角洲行动（Delta Force）

**候选**：[Entropy-Increase-Team/delta-force-plugin](https://github.com/Entropy-Increase-Team/delta-force-plugin)

**数据链路（据其 README）**：
> "插件采用**统一后端处理**，使用插件请前往**管理页面进行注册登陆并获取 apikey**，如果需要部分功能，可选择**订阅专业版（4.5 元/月）**，费用仅供服务器维护"

配置项：
- `api_key` — 在 **`https://df.shallow.ink/api-keys`** 创建
- `clientID` — 在 **`https://df.shallow.ink/`** 个人信息获取

**本地化合规判定：❌ 不通过（硬性冲突）**

| 约束 | 实际情况 | 判定 |
| :--- | :--- | :--- |
| 不把游戏数据存到远程设备 | 所有查询经 `df.shallow.ink` 第三方统一后端中转 | **❌ 违反 L3** |
| 不依赖远程服务可用性 | 第三方后端停服/收费即功能全废 | ❌ 违反 |
| 完全拒绝远程指令依赖 | 插件行为受第三方后端返回内容驱动（TTS/音频等亦为远程资源） | **❌ 违反 L4 精神** |

**附加风险**：
- 其登录流程涉及 **QQ / 微信扫码授权**，凭据流向第三方后端，**安全等级远低于本项目"本地扫码 + 本地落盘"**；
- 功能含 `#三角洲登录`、角色语音合成（TTS）、鼠鼠音乐等**远程资源**。

### 4.3 需求 4 结论对比

| 游戏 | 插件 | 数据链路 | 本地化 | 建议 |
| :--- | :--- | :--- | :---: | :--- |
| **鸣潮** | waves-plugin | 本地登录服务 + 直连库街区官方 | ✅ | **可适配**（需安全审计 + 端口隔离规划） |
| **三角洲** | delta-force-plugin | 第三方统一后端 `df.shallow.ink` + api_key | ❌ | **不建议接入**；若必须，需自研仅走官方接口的最小实现 |

---

## 5. 综合优先级与风险矩阵

| 需求 | 可行性 | 对现有功能影响 | 本地化 | 稳定性风险 | 建议优先级 |
| :--- | :---: | :--- | :---: | :--- | :---: |
| **3. 禁用原神/崩铁命名空间** | 高 | **低**（纯配置、可回滚） | 无影响 | 低（唯一风险是枚举误禁） | **P0** |
| **1. 米游社自动签到** | 高 | 低—中（同 Cookie 风控耦合） | ✅ | 中（需实测接口） | **P1** |
| **2. 全角色面板** | 高 | 低（新增独立命令） | ✅ | **中—高**（密集请求触发 1034） | **P2** |
| **4a. 鸣潮接入** | 高 | 中（新增容器/端口） | ✅ | 中 | **P2** |
| **4b. 三角洲接入** | — | — | **❌** | — | **不建议** |

### 5.1 稳定性总原则（贯穿四项）

1. **一律采用独立插件目录**，不改 ZZZ-Plugin / genshin / miao-plugin 源码 —— 实现零冲突、可随时删除回滚；
2. **一律复用现有 `NoteUser` 凭据**，不新增凭据副本、不落明文日志（延续 Phase 4 脱敏标准）；
3. **涉及官方风控接口的功能（签到、全角色面板）必须做请求限速与错峰**，避免互相拖垮；
4. **命名空间分配**：绝区零 `%` / `#` / `/`、鸣潮 `~`、控制类自留 —— 三者天然隔离；
5. **绝不引入**任何要求"注册账号 / api_key / 数据上传"的第三方后端（直接否决三角洲方案）。

---

## 6. 待您确认的决策点

1. **需求 1**：是否授权先做一次**接口实测**（用现有凭据发一次签到请求，抓真实 `act_id` 与返回码）？这是唯一需要"拿日志才能定论"的环节。
2. **需求 2**：全角色面板是否接受"**手动触发 + 2~3 分钟耗时**"，还是希望改为"**分批/仅部分角色**"以进一步降低风控？
3. **需求 3**：确认采用 **`group.yaml` 精确枚举禁用**（而非目录隔离，因为 `miao-plugin` 是绝区零的依赖承重墙）？
4. **需求 4**：三角洲因**硬性违反本地化约束**，是否直接排除？鸣潮是否进入安全审计排期？

---

### 附：本报告关键证据索引

| 结论 | 证据位置 |
| :--- | :--- |
| `/→#` 内核改写 | `/root/Yunzai/config/config/bot.yaml:38`、`lib/plugins/loader.js:374` |
| 原神抢占 `#面板列表` | `plugins/miao-plugin/apps/profile.js:20` |
| 插件禁用机制 | `config/config/group.yaml`、`lib/plugins/loader.js:691` |
| ZZZ 面板走 Enka | `ZZZ-Plugin/config/config.yaml`（`enkaApi`）、`dist/apps/panel.js:1-2` |
| 全角色 API 存在但未调用 | `ZZZ-Plugin/dist/lib/avatar.js:7,19`（导出）vs 全 `dist/` 零调用点 |
| 签到功能缺失 | 全插件树 `签到` 检索（仅过滤/文案命中） |
| 三角洲第三方后端 | delta-force-plugin README（`df.shallow.ink` + `api_key`） |
| 鸣潮本地登录服务 | waves-plugin README（本地 `25088` 登录服务） |
