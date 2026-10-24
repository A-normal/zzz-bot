# 游戏管理依赖（Game-Hub）与多社区·多渠道微内核架构规格说明书
## （渠道接入、社区驱动与纯游戏指令“三向中枢”设计规范）

- **版本**: `v2.0.0 (Tri-Partite Broker Edition)`
- **更新时间**: `2026-10-24 23:55:00 +08:00`
- **核心论点**: 确立 `Game-Hub` 必须同时管好**“三件事”**——**西向渠道接入（接QQ/Telegram等）**、**东向社区驱动（接米游社/库街区等）**、**北向游戏业务（挂绝区零/崩铁/鸣潮等）**。通过中枢抹平平台差异，实现全链路的松耦合与自由插拔。

---

## 一、 为什么渠道层（QQ/Telegram）是不可或缺的“第三只脚”？

### 1.1 现状痛点：混乱的渠道异构性
在云崽当前生态中，看似“只要写好游戏功能就行”，但实际各渠道消息格式四分五裂，导致所有游戏插件都写满了平台兼容特判：

1. **用户身份 ID 格式碎裂**：
   - 官方 QQBot：43 位哈希字符串（如 `1904107636:F9F6331F761AE56AC1F49A8C197D1AFA`）；
   - Telegram：纯数字前缀字符串（如 `tg_797397241`）；
   - NapCat / OneBotv11：原生纯数字 QQ 号（如 `123456789`）；
   - 这直接导致用户的 UID 绑定数据（`Users` 表）完全无法跨平台甚至跨适配器共享。
2. **`@Bot` 判定机制各异**：
   - QQBot 适配器：将 mention 转为 `at` 消息段，置位 `e.atBot = true`；
   - Telegram 适配器：不产生 `at` 段，仅在文本中留下 `@username`，`e.atBot` 恒为假，插件必须自己拉取 `bot.info.username` 去正则匹配；
   - 传统 OneBot：包含 CQ 码 `[CQ:at,qq=...]`。
3. **输出能力的非对称性**：
   - Telegram / NapCat：支持原生 Markdown、长文本和多层合并转发；
   - 官方 QQBot：被严格限制 Markdown 与合并转发，超长内容只能强制走 Puppeteer 渲染为图片。

**结论**：如果 `Game-Hub` 不把渠道接入与事件归一化纳入核心职责，顶层的游戏插件就永远无法做到“纯指令、纯业务”，依然要被迫感知底层到底跑在 QQ 还是 Telegram 上！

---

## 二、 Game-Hub “三向中枢”整体拓扑架构

```text
                               【北向】游戏业务插件层 (Game Feature Plugins)
                           +---------------------------------------------------+
                           |  game-plugin-zzz  |  game-plugin-hsr  |  wuwa...  |
                           |  (纯语义指令清单:   |  (纯语义指令清单:   |  (纯指令: |
                           |   便签/面板/码)   |   差分/遗器/便签) |   深坠)   |
                           +---------------------------------------------------+
                                                     ▲
                                                     │ 派发纯指令 (Pure Command)
                                                     │ 注入统一上下文 (UnifiedContext)
                                                     ▼
+=======================================================================================================================+
|                                    ★【中枢】Game-Hub (三元微内核管理总线)                                             |
|                                                                                                                       |
|   1.【西向·渠道抽象层 (Inbound Channel Engine)】                                                                      |
|      - 统一事件抽象器 (UnifiedEvent Normalizer): 抹平 QQ(NapCat/Official)、Telegram、Discord 消息结构                 |
|      - 统一身份中继器 (Global Identity Vault): 映射 Channel UID (QQ号/TG ID) -> 通行证凭据 -> 游戏角色 UID           |
|      - 发送能力整形器 (Capability Shaper): 根据渠道特性动态选择输出 Markdown / 合并转发 / 渲染长图                   |
|                                                                                                                       |
|   2.【中央·动态命名空间中控 (Namespace Dispatcher)】                                                                  |
|      - 部署人员配置表 (config/namespaces.yaml): 部署员自主定义各游戏前缀 (*, /, %, zzz...)                            |
|      - 动态路由编译器: 捕获渠道消息 -> 剥离配置前缀 -> 提取纯语义词元 -> 校验驱动 -> 精准调度至北向插件               |
|                                                                                                                       |
|   3.【东向·社区驱动管理 (Outbound Community Registry)】                                                              |
|      - 动态挂载各底层社区 Provider (mihoyo, kuro, tencent...)                                                          |
|      - 提供开箱即用的通用通信客户端、自动签名计算 (DS) 与全局风控感知 (1034 验证码)                                   |
+=======================================================================================================================+
                   ▲                                                               ▲
                   │ 接入各平台聊天消息                                            │ 调度各社区 API
                   ▼                                                               ▼
+---------------------------------------+                       +---------------------------------------+
|  【西向】渠道接入层 (Channel Inbound) |                       | 【东向】社区驱动层 (Community Outbound)|
|  - QQ (NapCat / OneBotv11)            |                       | - provider-mihoyo (米游社/HoYoLAB)    |
|  - QQ (官方开放平台 QQBot)            |                       | - provider-kuro (库洛/库街区)         |
|  - Telegram Bot API                   |                       | - provider-future (未来新社区...)     |
+---------------------------------------+                       +---------------------------------------+
```

---

## 三、 第一件大事：西向渠道消息接入与归一化标准

`Game-Hub` 负责将来自任何渠道平台的原始消息，实时转化为跨平台的 `UnifiedMessageEvent` 标准对象：

### 3.1 统一事件模型（`UnifiedMessageEvent`）
```typescript
export interface UnifiedMessageEvent {
  // 1. 跨平台规范化标识
  channel: 'qq-napcat' | 'qq-official' | 'telegram' | 'discord';
  userId: string;              // 规范化用户主键，格式如 "qq:123456" 或 "tg:797397"
  groupId?: string;            // 群标识，如 "qq_group:37612..."
  isPrivate: boolean;          // 是否私聊
  
  // 2. 交互意图归一化
  isAtBot: boolean;            // 无论平台是文本 @、mentions 还是 CQ 码，中枢统一判定
  rawText: string;             // 剥离掉 @Bot 后的干净纯文本消息
  messageChain: MessageSegment[]; // 标准化消息链（Text, Image, At, Reply）
  
  // 3. 自适应回复函数 (能力抹平)
  reply(content: ReplyContent, options?: ReplyOptions): Promise<any>;
}
```

### 3.2 响应能力动态整形（Capability Shaper）
不同平台支持的富媒体能力完全不同，游戏插件不需要关心这些细节：
- 当游戏插件返回 Markdown 文本时：
  - 若当前渠道为 **Telegram / NapCat**：直接以原生 Markdown 发送；
  - 若当前渠道为 **官方 QQBot**：Game-Hub 自动调取无头渲染器将 Markdown 转为精美图片发送；
- 当游戏插件需要发送多条流水日志时：
  - 若渠道支持合并转发：自动封装为合并转发卡片；
  - 若渠道不支持：自动拼接并渲染为长图。

---

## 四、 第二件大事：东向社区驱动与通行证网关

`Game-Hub` 负责以标准 SPI 形式挂载各厂商的独立社区驱动，提供账号生命周期与网络请求中枢：

### 4.1 社区驱动 SPI 契约（`ICommunityProvider`）
```typescript
export interface ICommunityProvider {
  id: string;                  // 'mihoyo' | 'kuro'
  name: string;                // '米游社' | '库街区'
  
  // 登录与鉴权
  auth: {
    createQrCode(): Promise<{ qrUrl: string; ticket: string }>;
    pollQrStatus(ticket: string): Promise<{ status: 'waiting' | 'scanned' | 'confirmed'; token?: any }>;
    refreshToken(token: any): Promise<boolean>;
  };

  // 全量角色绑定拉取
  roles: {
    fetchGameRoles(token: any): Promise<Array<{ game: string; uid: string; region: string; nickname: string }>>;
  };

  // 签名与请求网关
  client: {
    request(options: RequestOptions): Promise<any>;
  };
}
```

---

## 五、 第三件大事：中央动态命名空间调度与纯游戏业务

`Game-Hub` 负责连接部署人员偏好与开发者纯指令，彻底终结全局宽正则冲突：

### 5.1 部署人员配置规格（`config/namespaces.yaml`）
每个实际部署 Bot 的管理员（Deployer），自主定义自己机器人的前缀方案：
```yaml
namespaces:
  # 部署员 A 喜欢用星号触发绝区零
  zzz:
    prefix: "*"                # 用户输入：*便签、*面板
    aliases: ["zzz", "绝区零"]  # 用户输入：zzz便签、绝区零面板 均可触发
    priority: 100

  # 部署员 B 喜欢用斜杠触发绝区零与鸣潮
  wuwa:
    prefix: "/"                # 用户输入：/鸣潮便签、/声骸
    aliases: ["鸣潮", "mc"]
    priority: 90
```

### 5.2 游戏插件纯指令契约（`IGamePluginManifest`）
开发者只写纯业务，不写前缀，不写底层网络特判：
```typescript
export const manifest: IGamePluginManifest = {
  id: "zzz",
  name: "绝区零",
  community: "mihoyo",
  routes: [
    { id: "note", tokens: ["便签", "体力", "每日", "note"], handler: "handleDailyNote" },
    { id: "panel", tokens: ["面板", "更新面板"], hasArgs: true, handler: "handlePanel" },
    { id: "code", tokens: ["兑换码", "code"], handler: "handleCode" }
  ]
};
```

---

## 六、 统一身份拓扑模型（Global Identity Vault）

`Game-Hub` 核心建立的三维身份映射数据库模型，彻底解决跨平台数据流转：

```text
  [西向渠道身份]                    [中枢通行证凭据]                   [东向游戏角色拓扑]
  Channel User                      Community Account                  Game Role
+-------------------+             +-------------------+              +-------------------+
| ID: qq:123456789  | ----+       | Provider: mihoyo  | --------+--> | Game: zzz         |
+-------------------+     |       | LTUID: 19882312   |         |    | UID: 17708598     |
                          +-----> | Cookies: ...      |         |    +-------------------+
+-------------------+     |       | DeviceFP: 38d...  |         |
| ID: tg:797397241  | ----+       +-------------------+         +--> | Game: sr          |
+-------------------+                                                | UID: 10023451     |
                                  +-------------------+              +-------------------+
                                  | Provider: kuro    | ------+
                                  | Token: ...        |       +----> | Game: wuwa        |
                                  +-------------------+              | UID: 10588231     |
                                                                     +-------------------+
```

- **无缝认领**：用户在 Telegram 绑过绝区零，在 QQ 只要通过 `/认领` 或统一扫码，底层自动将其 `qq:123456` 与原米游社通行证及游戏 UID 关联，零数据丢失！

---

## 七、 总结：三位一体的终极架构意义

将渠道接入正式纳入 `Game-Hub` 职责后：
1. **西向接渠道**：NapCat、Telegram、官方Bot 自由换，身份统一，消息归一；
2. **东向接社区**：米游社、库街区自由插拔，底层 API 与动态签名自动封装；
3. **北向接游戏**：游戏开发者只写纯指令业务，部署管理员随心定制触发符号（`*`、`/`、`%`）。

这才是真正意义上高内聚、低耦合、现代化的通用游戏机器人总线！
