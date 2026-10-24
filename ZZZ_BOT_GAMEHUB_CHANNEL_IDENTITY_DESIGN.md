# Game-Hub 多渠道身份与分发设计评估

- **报告生成时间**：`2026-10-24 23:58:00 +08:00`
- **报告性质**：只读调研 + 设计评估（未修改任何代码/容器/配置；容器侧仅只读查询 SQLite）
- **任务目标**：评估"`game-hub` 成为唯一分发中枢、chat 作为其中一个插件、移除 `zzzShortcuts`/`chatAi`、以新仓库替代现有 zzz-Bot 仓库"的方案；重点回答**多渠道（QQ + Telegram）与多渠道多部署方式如何对接、绑定、共享同一份用户数据**。
- **大致内容**：现状身份机制实测 → 四个真问题 → 三层身份模型与表结构 → 跨渠道合流流程 → 部署/传输矩阵 → 分发契约（谁决定回不回）→ 迁移与验收 → 待拍板。
- **详细结论**：
  1. **方向没问题**，但当前系统**并没有真正的"跨渠道同一个用户"模型**——它是靠"同一米游社账号（ltuid）被多条平台身份行引用"自然合流的，实测里已经出现"同一人两条身份行""同一 ltuid 被两人绑定"的情况。新 hub 不是重实现，而是**补上缺失的 Principal 层**。
  2. **真正的困难点不是"怎么接多个渠道"（那是 adapter 的活），而是"平台身份 ↔ 人 ↔ 米游社账号"的三层映射与合流规则**，以及"合流时怎么防止别人抢绑你的号"。
  3. **"大部分群消息交给 chat 决定回不回"必须分三级**：硬路由（0 成本，先切走指令）→ 轻量筛选（批量小模型）→ 主模型。否则成本与延迟不可控，且会抢答游戏指令。

---

## 1. 现状实测：所谓"两个渠道拿到同一个用户数据"到底是怎么实现的

【实测】容器 `/root/Yunzai/data/db/data.db`（2026-10-24 23:50）：

```
Users(14 行)   id = 平台用户 ID            ltuids = 该用户绑定的米游社 ltuid 列表   games = JSON（当前选中账号的游戏 UID）
  TG      tg_7390688139        ltuid=[82208305, 283399052]   games=[gs=182567712, sr=100210522, zzz=17708598]
  OPENID  1904107636:53DD08A…  ltuid=[82208305]              games=[gs=114549139, sr=106074162, zzz=13214172]
  OPENID  1904107636:27B1010…  ltuid=[310868610]             games=[gs=343219787, sr=101301149, zzz=12290264]
  OPENID  F9F6331F761AE56AC1…  ltuid=[]                      games=[空]
  QQNUM   999999999 / 88888    ltuid=[]                      games=[空]
  …其余 8 行均为空绑定

MysUsers(3 行)  ltuid 主键 + ltoken ck + device fp + uids JSON
  ltuid=283399052  uids={gs:[182567712], sr:[100210522], zzz:[17708598]}
  ltuid=82208305   uids={gs:[114549139], sr:[106074162], zzz:[13214172]}
  ltuid=310868610  uids={gs:[343219787], sr:[101301149], zzz=[12290264]}
```

**三条关键结论**：

| # | 事实 | 含义 |
| :-: | :--- | :--- |
| 1 | **跨渠道共享的唯一锚点是 `MysUsers.ltuid`**（米游社账号），它与聊天渠道完全无关 | 这就是为什么"QQ 和 TG 共享一份数据"看起来成立：两边都指向同一个 ltuid，`ck`/`uids` 只有一份 |
| 2 | `Users.games` **只是"当前选中账号"的缓存**：`tg_7390688139` 的 `ltuids` 有两个，但 `games` 只保留了 `283399052` 那一套 | 在任一渠道切换账号会**覆盖同一个 JSON**；这是"看起来共享"之外的真实副作用 |
| 3 | **同一个 ltuid `82208305` 被 `tg_7390688139` 和 `1904107636:53DD08A…` 两条身份行同时引用**；并且同一人还存在 `1904107636:F9F6331F…` 与 `F9F6331F761AE56AC1…` 两种拼写（AppID 前缀 vs 裸 openid） | 当前系统**无法区分"同一人"与"两个人共用一个米游社号"**，也无法防止重复身份行 |

> 所以现状的准确描述是：**"渠道各一套身份行 + 共享米游社账号行"**，而不是"渠道无关的用户模型"。用户感知的"两个渠道是一份数据"成立，是因为业务数据（抽卡/面板）按**游戏 UID** 存、`ck` 按 **ltuid** 存——恰好这两层都跟渠道无关，把中间的"人"这一层缺失给掩盖了。

---

## 2. 四个真问题（新方案自带的坑，按严重度）

| 编号 | 问题 | 为什么是真问题 | 对策方向 |
| :-: | :--- | :--- | :--- |
| **P1** | **身份模型缺失**：没有"人"这一层，平台 ID 直接当主键 | 换渠道=换主键；一人多号/一号码多人无法表达；合流无法审计 | 引入 Principal（见 §3），identity 降级为"登录方式之一" |
| **P2** | **"全量群消息交给 chat 决定回不回" 的成本与延迟** | 即使决定"不回"也要一次模型调用；活跃群一天数千条 → 钱、延迟、限流三杀 | 三级过滤 + **观察与调用分离**（见 §6） |
| **P3** | **"唯一分发" 与指令功能抢答** | chat 若先拿到全部消息，`/面板`、`%便签` 会被它"自由发挥"；若硬路由先切，chat 又必须知道"这条已被别人处理" | 硬路由 → chat 两段式 + `consumed` 打标（见 §6） |
| **P4** | **多实例 / 多部署方式的会话键与权限** | 两个 QQ 号在同一个群、或同一个人有两个号，会话键只看 `group_id` 会互相串；两个 bot 号各自一套群记忆也很怪 | `conversationKey = adapter + instance + surface + externalId`；**群记忆按群（跨实例共享）**、**对话按会话隔离**（见 §5） |

---

## 3. 三层身份模型（核心）

```
Principal（人）          ← 唯一稳定身份，永不由渠道决定，ULID
   ├─ Identity（登录方式）  ← (adapterType, instanceId, externalId)，可多条
   │     · napcat/qq-main/1234567
   │     · telegram/tg-bot/7390688139
   │     · napcat/qq-spare/7654321      ← 同一人的第二个号
   └─ CommunityAccount（社区账号）← (community=mihoyo, accountId=ltuid)，**与渠道无关**
         └─ Role（游戏角色）        ← (game=zzz, uid=17708598)
```

**为什么必须是这三层**：
- 把 `Identity` 从主键变成"登录方式"，**换通道零迁移**（这也回答了上一份 NapCat 方案的 H1）。
- 把 `CommunityAccount` 与渠道彻底解耦：`ck`/`device`/`uids` 只挂一次，多渠道天然共享。
- `Principal` 让"一个人两个号"（QQ 主号 + 小号）和"一个号两个人"（家庭共享）都能表达，且**可审计、可解绑**。

### 3.1 表结构（SQLite，可直接落地）

```sql
-- 人
CREATE TABLE principals (
  id TEXT PRIMARY KEY,            -- ULID
  status TEXT NOT NULL DEFAULT 'active',   -- active|frozen|merged
  merged_into TEXT,               -- 合并审计
  created_at INTEGER NOT NULL
);

-- 登录方式（渠道身份）
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  adapter_type TEXT NOT NULL,     -- onebot11 | telegram | satori | …
  instance_id TEXT NOT NULL,      -- 渠道实例（哪个 bot 号/哪个 token）
  external_id TEXT NOT NULL,      -- 平台侧用户 id（QQ 号 / TG id / openid）
  display_name TEXT,
  verified_at INTEGER,            -- 合流确认时间；NULL=未验证（仅"见过"）
  created_at INTEGER NOT NULL,
  UNIQUE (adapter_type, instance_id, external_id)
);

-- 渠道实例（多部署方式）
CREATE TABLE channel_instances (
  instance_id TEXT PRIMARY KEY,
  adapter_type TEXT NOT NULL,
  self_id TEXT,                   -- 机器人自身 id（QQ 号 / bot id）
  transport TEXT NOT NULL,        -- ws-reverse | ws-forward | http | polling | webhook
  enabled INTEGER NOT NULL DEFAULT 1,
  config_ref TEXT                 -- 指向配置文件/密钥条目，不存明文
);

-- 社区账号（渠道无关）
CREATE TABLE community_accounts (
  id TEXT PRIMARY KEY,
  community TEXT NOT NULL,        -- mihoyo | kuro
  account_id TEXT NOT NULL,       -- ltuid
  ck_enc BLOB,                    -- 加密存储，禁止明文/禁止进 git
  device_fp TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (community, account_id)
);

-- 人 ↔ 社区账号（允许 1:N；共享场景后续再放开 N:N）
CREATE TABLE principal_accounts (
  principal_id TEXT NOT NULL REFERENCES principals(id),
  community_account_id TEXT NOT NULL REFERENCES community_accounts(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  added_by TEXT NOT NULL,         -- self | claim | migration
  created_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, community_account_id)
);

-- 游戏角色
CREATE TABLE roles (
  community_account_id TEXT NOT NULL REFERENCES community_accounts(id),
  game TEXT NOT NULL,             -- gs | sr | zzz | honkai3
  uid TEXT NOT NULL,
  nickname TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (community_account_id, game, uid)
);

-- 会话（渠道内）
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  adapter_type TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  surface TEXT NOT NULL,          -- group | private | guild | channel
  external_id TEXT NOT NULL,      -- group_id / user_id
  title TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (adapter_type, instance_id, surface, external_id)
);

-- 群线程（跨实例共享记忆的锚）
CREATE TABLE group_threads (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL UNIQUE, -- "qq:<群号>" / "tg:<chat_id>"，**不含实例**
  title TEXT,
  memory_json TEXT,               -- 梗/规则/禁语
  auto_speak INTEGER NOT NULL DEFAULT 0
);

-- 消息流水（观察用，非调用用）
CREATE TABLE messages (
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  identity_id TEXT,
  kind TEXT NOT NULL,             -- text|image|at|reply|system
  payload TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, seq)
);
```

**关键约束**（写进代码 review 清单）：
1. `identities.external_id` **绝不能**当任何业务表的外键——业务只认 `principal_id`。
2. `community_accounts` 与 `channel_instances` 之间**不得存在任何直接引用**（渠道无关性是这条架构的生命线）。
3. `group_threads.group_key` **不含 instance**（同群两个 bot 号共享群记忆）；`conversations` **含 instance**（两个号各自的对话流不串）。

---

## 4. 跨渠道合流：怎么让"QQ 的我和 TG 的我"变成一个人

### 4.1 三种触发

| 场景 | 做法 |
| :--- | :--- |
| **首绑（任一渠道）** | 扫码/CK → 得 `ltuid` → `community_accounts` 有则复用、无则新建 → 若该账号尚无 Principal，则新建 Principal + Identity + `principal_accounts(is_default=1)` |
| **第二渠道首次出现** | 默认走**认领码双向确认**（§4.2） |
| **迁移期一次性** | 按 `ltuid` 聚合老 `Users` 行（§5.3），但**必须人工复核**，因为可能是共享账号 |

### 4.2 认领码（推荐默认，防抢绑）

```
渠道 A（已验证）：/我的码              → 6 位码，TTL 5min，绑定 principal_A，一次性
渠道 B（未验证）：/认领 482913          → 把 B 的 identity 挂到 principal_A，标记 verified
                  /认领 <游戏UID>       → 仅当该 UID 已归属某 principal 且其只有 1 个 identity 时，
                                          仍要求 A 侧再发一次码确认（不做"UID 即所有权"）
```

- 为什么不做"UID 即所有权"：任何人只要知道你的米游社 UID 就能抢绑，而 UID 在群里是公开的。
- 失败计数 + 冷却（5 次/10min → 锁 1h），全部进审计。
- 反向操作：`/解绑` 只摘 identity，**不删** principal 与 community_account。

### 4.3 一人多号 / 一号多人

- **一人多号**：一个 Principal 多条 Identity。`/我的绑定` 列出所有渠道身份，可逐条解绑。
- **一号多人（家庭共享）**：本版**先不做**（`principal_accounts` 仍是 1:N）。要支持的话把它改成 N:N + 每条带权限位（只读/可抽卡/可改 cookie），这是独立增量。

---

## 5. 作用域规则：什么该跨渠道共享，什么绝对不该

| 数据 | 作用域 | 理由 |
| :--- | :--- | :--- |
| 米游社账号、CK、游戏 UID、面板/抽卡数据 | **Principal + CommunityAccount** | 真实资产，跨渠道必须一致 |
| 偏好（模型、语言、接不接受主动消息） | **Principal** | 跟着人走，不跟着渠道走 |
| 对话上下文（最近 K 轮） | **Conversation**（渠道 + 群/私聊） | 群聊和私聊是不同语境，混了就是串味 |
| 群记忆（梗、规则、禁语、能不能插话） | **GroupThread（只按群）** | 同群两个 bot 号应共享记忆；按实例分会精神分裂 |
| 用量 / 配额 / 冷却 | Principal + 群 双重 | 防个人刷、防群烧钱 |
| 主动发言许可 | GroupThread（群友 `/闭嘴`） | 由被骚扰的一方决定 |

### 5.1 迁移期一次性聚合（把 14 行老数据搬进新模型）

```
对每个 MysUsers.ltuid L：
  找出所有 Users 行 U，使 L ∈ U.ltuids 或 L 的某个 uid ∈ U.games
  若这些 U 行分属不同"人"，则按 ltuid 聚成 1 个 Principal，每个 U 行变成一条 Identity
  若某 U 行没有 ltuids（只有 games 的空壳或纯 uid），走"待认领"队列，不自动合并
```

**实测结果预判**（按 §1 的数据）：
- `ltuid=82208305` 同时被 `tg_7390688139` 与 `1904107636:53DD08A…` 引用 → 聚成 1 个 Principal + 2 条 Identity（**这正是"用户以为的一人"**，但**必须你人工确认一次**，因为也可能是两人共用）。
- `1904107636:F9F6331F…` 与 `F9F6331F761AE56AC1…` 是同一人的两种 id 拼写 → 迁移时**去重成一条 Identity**（并记一条 conflict 日志）。
- 其余 8 行空绑定 → 直接建 Principal + Identity，无账号关联。

> 迁移脚本必须产出**对账报告**：`principals` 数、`identities` 数、`community_accounts` 数、`roles` 数、冲突列表、跳过列表。数字对不上就不许切换。

---

## 6. 分发契约：chat 怎么"决定回不回"才不烧钱、不抢答

### 6.1 三级过滤（观察 ≠ 调用）

```
L0 硬路由（0 成本，必跑，确定性）
   命名空间 / # % ～、裸词指令表、game 插件声明的 namespace（IGameManifest）
   → 命中即独占派发，打 e.consumed = true
   @bot / 回复 bot / 私聊 → 直接进 L2（chat 必答，不再筛）

L1 观察 + 轻筛（低成本，按批）
   全部消息只落 messages 表（便宜），不调模型
   每 5~10 条 / 或每 30s 批一次 → 本地规则 + 小模型打"是否值得回复"的分
   （用本地 ollama 或最便宜的远端小模型；输出结构化：{score, topic, addressed}）

L2 主模型（贵，只在上一步 positive 时）
   组装上下文（群流水 + 群记忆 + 该 principal 的账号信息），产出：
   {should_reply, segments, delay_ms, reason}
```

### 6.2 三条硬规矩

1. **谁消费谁打标**：任何插件处理了事件就打 `consumed`；chat 只看"剩下的"。这同时解决了 P3 的抢答问题和未来加插件的冲突。
2. **观察全量、调用闸门**：`messages` 表可以无限存（文本 + 占位符），但模型调用必须有预算（每人/每群/全局日额度 + 并发 1/会话）。
3. **兜底必须"沉默是默认"**：`should_reply=false` 是合法结果，且要在日志里记"为什么没回"（可解释性），否则调参无从下手。

### 6.3 与 Game-Hub 的接口

```ts
interface IGameManifest {          // 游戏插件向 hub 注册
  gameId: string; communityId: string; name: string;
  namespace: { explicitPrefixes: string[]; slashCommands: string[]; bareKeywords: string[] };
}
interface IChatPlugin {            // chat 向 hub 注册
  pluginId: 'chat';
  // 只在 hub 判定"未被消费"时被调用
  evaluate(evt: NormalizedEvent, ctx: HubContext): Promise<ChatDecision | null>;
}
interface HubContext {
  principal?: Principal;           // 已识别的人（可能没有）
  conversation: Conversation;      // 当前会话
  group?: GroupThread;
  accounts(): CommunityAccount[];  // 该人的社区账号
  roles(community?: string): Role[];
  recent(conversationId: string, n: number): Message[];
}
```

---

## 7. 多部署方式：不是"改造 NapCat"，而是 adapter × transport

### 7.1 矩阵

| adapterType | transport | 部署形态 | 备注 |
| :--- | :--- | :--- | :--- |
| `onebot11`（NapCat） | `ws-reverse`（我们开 WS server，NapCat 连进来） | NapCat 独立容器 | 与现状一致；token 鉴权（`Authorization: Bearer …`） |
| `onebot11` | `ws-forward`（我们连 NapCat 的 3001） | NapCat 独立容器 | 适合 NapCat 在另一台机器/需要穿透 |
| `onebot11` | `http`（NapCat 回调 + 我们调 API） | 同上 | 不推荐（两份通道） |
| `telegram` | `polling` | 任意 | 无公网必须 |
| `telegram` | `webhook` | 有公网/反代 | 延迟更低 |
| `satori` / 其它 | 视协议 | — | 预留 |

**统一抽象**：`ChannelAdapter { adapterType, instanceId, start(), stop(), send(conversationId, segments, opts), capabilities }`，事件归一化成 `NormalizedEvent`：

```ts
interface NormalizedEvent {
  eventId: string;                 // 去重用（NapCat message_id / TG update_id）
  instanceId: string;              // 哪个 bot 实例
  surface: 'group' | 'private' | 'guild' | 'channel';
  conversationKey: { adapterType, instanceId, surface, externalId };
  selfId: string;                  // 机器人自身 id
  sender: { externalId: string; displayName?: string; roles?: string[] };
  content: Segment[];              // 归一化消息段（text/image/at/reply/…）
  atSelf: boolean; replyToBot: boolean;
  raw?: unknown;                   // 仅调试用，不入库
}
```

### 7.2 关于 NapCat 要不要"改造"

**你的判断是对的：不需要改造。** 但要分清两种落地：

| 方案 | NapCat 侧动作 | 我们要写的 | 评价 |
| :--- | :--- | :--- | :--- |
| **A（推荐）通道层沿用 TRSS-Yunzai** | 加一个 compose 服务 + 反向 WS + token，**零改造** | `hub` 作为 Yunzai 插件接管 -1000 分发，把 Yunzai 的 `e` 归一化成 `NormalizedEvent` | 通道层是脏活且已成熟（OneBot/Satori/Telegram 全支持），重写它收益低、风险高 |
| B 新仓库独立实现通道 | 零改造 | 自己写 `onebot11` adapter 的 3 种 transport + `telegram` 2 种 | 更"纯"，但要自己处理重连/心跳/分段编码/限流/风控，工期至少翻倍 |

→ 建议 **A**：`game-hub` 只做"业务与身份"，`Yunzai` 只做"通道与渲染"。这样"NapCat 改造"这件事在新架构里**根本不存在**，只是"加一个 adapter 实例"。

---

## 8. 现有资产处置

| 资产 | 处置 |
| :--- | :--- |
| `zzz-Bot` 仓库 | 转**只读归档**（打 tag `legacy-archive`），不再推新改动（你的判断成立）；容器继续跑到新系统上线 |
| `zzzShortcuts` / `zzzAIChat` / `aiChatCore` | 不迁移代码，只搬**规则表**（裸词指令表、命名空间字符类、`e._replied` 教训、通道路由矩阵的 14 种形态） |
| `data/db/data.db`（14+3 行） | 一次性迁移 + 对账报告（§5.1） |
| Redis 546 key | 只迁 `ZZZ:SIGN`（签到托管）、`ZZZ:REMIND`、`ZZZ:PANEL` 这类业务配置；`Yz:count`/`miao:rank` 直接丢 |
| NapCat 连接结论（反向 WS / token / healthcheck 坑） | 直接复用 |
| DSH 开发模式结论（loopback-only + cookie 鉴权 + headless 降级） | 直接复用，作为新仓库的 `dev` 插件 |
| `tmp_lotus/` | 移出仓库或 ignore；专有许可，只作参考 |

---

## 9. 待拍板

| # | 决策 | 选项 | 我的建议 |
| :-: | :--- | :--- | :--- |
| E1 | 通道层 | ①沿用 TRSS-Yunzai（hub 作为插件）②新仓库自研 adapter | **①**：省一半工期，且不引入通道层风险 |
| E2 | 合流默认方式 | ①认领码双向确认 ②UID 即所有权 ③人工对表 | **①**（②有抢绑风险，③不可持续） |
| E3 | 一号多人共享 | ①本版不做（1:N）②直接上 N:N + 权限位 | **①**，留扩展点 |
| E4 | 群记忆粒度 | ①按群（跨实例共享）②按实例+群 | **①** |
| E5 | L1 轻筛模型 | ①本地 ollama 小模型 ②最便宜的远端小模型 ③纯规则 | **③ 先跑通，再按误判率换 ①/②** |
| E6 | `Users.games` 那套"当前账号"语义 | ①保留（每 Principal 一个 is_default）②删掉，改成显式选择 | **①**，但语义改成"Principal 级默认账号"，不再按渠道各存一份 |
