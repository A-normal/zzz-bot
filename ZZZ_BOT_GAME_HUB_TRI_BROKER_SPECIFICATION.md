# Game-Hub 三向微内核总线架构实施规格与接口契约设计书
## （渠道宿主复用 · 社区驱动 SPI · 纯语义游戏插件与动态命名空间）

- **时间戳**: `2026-10-25 00:15:00 +08:00`
- **任务目标**: 将经多轮讨论达成高度共识的“三向微内核总线（Game-Hub）”概念模型转化为工业级软件工程契约，涵盖：
  1. 西向：复用 Yunzai 现有 Adapters 的事件整形与跨端身份中继接口；
  2. 东向：南向社区驱动（Community Provider SPI）标准接口定义；
  3. 中央：基于部署人员配置的动态命名空间编译器与词法路由算法；
  4. 北向：游戏业务插件纯指令清单（Pure Tokens Manifest）与上下文注入规范；
  5. 落地演进路线：从当前 ZZZ-Bot 容器平滑迁移至独立总线的分阶段实施计划。

---

## 一、 系统全景架构图（微内核分层）

```text
==================================================================================================
【外部渠道网络】            QQ (NapCat / OneBotv11)     Telegram Bot API      官方开放平台 QQBot
==================================================================================================
                                                │
                                                ▼ (TCP / WebSocket / Webhook)
+------------------------------------------------------------------------------------------------+
|                        【传输宿主层】：Yunzai / TRSS-Yunzai Adapter 体系                        |
|                                                                                                |
|   - 职责：维护网络长连接、心跳、登录握手、事件解析，产出原生 Event (e)                         |
|   - 已内置：OneBotv11.js, Telegram-Plugin, QQBot-Plugin, ComWeChat, Satori 等                  |
+------------------------------------------------------------------------------------------------+
                                                │
                                                ▼ (Priority: -1000 前置拦截)
+================================================================================================+
|                   ★【三向治理中枢】：Game-Hub (独立基础设施插件 / 核心微内核)                   |
|                                                                                                |
|   1.【西向·渠道整形与身份中枢 (Inbound Shaper & Identity Vault)】                              |
|      - UnifiedEvent Normalizer: 抹平各平台 ID、补齐 Telegram 无 @Bot 缺陷、封装 replyAdaptive |
|      - Global Identity Vault: 跨平台用户主键映射 (`qq:123` / `tg:456`) -> 通行证凭据 -> 游戏UID|
|                                                                                                |
|   2.【中央·动态命名空间调度器 (Dynamic Namespace Dispatcher)】                                 |
|      - Deployer Config: 读取部署人员自定前缀 (如 A配 "*", B配 "/", C配 "%")                     |
|      - Token Compiler: 前缀剥离 -> 纯指令提取 -> 驱动校验 -> 精准调度至北向插件               |
|                                                                                                |
|   3.【东向·社区驱动中枢 (Community Provider Registry)】                                        |
|      - SPI 注册表: 动态挂载 provider-mihoyo (米游社)、provider-kuro (库洛)                     |
|      - 网络基础设施: Takumi/DS 签名生成器、Android 设备指纹池、1034 验证码拦截器               |
+================================================================================================+
                                                │
                                                ▼ 纯指令派发 (Pure Command) + 统一上下文注入 (Context)
+------------------------------------------------------------------------------------------------+
|                        【北向·游戏业务插件层】：纯游戏功能实现 (Game Plugins)                    |
|                                                                                                |
|   +--------------------------+  +--------------------------+  +----------------------------+   |
|   |     game-plugin-zzz      |  |     game-plugin-hsr      |  |     game-plugin-wuwa       |   |
|   |  - 纯指令: 便签/面板/码  |  |  - 纯指令: 差分/遗器/便签|  |  - 纯指令: 深坠/声骸/每日  |   |
|   |  - 依赖: provider-mihoyo |  |  - 依赖: provider-mihoyo |  |  - 依赖: provider-kuro     |   |
|   +--------------------------+  +--------------------------+  +----------------------------+   |
+------------------------------------------------------------------------------------------------+
```

---

## 二、 核心接口与数据结构契约定义

### 2.1 西向：统一事件门面（`IUnifiedEvent`）
```typescript
export interface IUnifiedEvent {
  // 1. 基础元数据
  channel: 'qq-napcat' | 'qq-official' | 'telegram' | 'wechat' | 'discord';
  unifiedUserId: string;       // 统一用户标识，如 "qq:1904107636" 或 "tg:797397241"
  groupId?: string;            // 统一群标识，如 "qq_group:376121234"
  isPrivate: boolean;          // 是否私聊
  
  // 2. 交互状态归一化
  isAtBot: boolean;            // 中枢统一计算（自动识别 Telegram @username 或 QQ mention）
  rawText: string;             // 剥离掉 @Bot 后的干净输入文本
  
  // 3. 自适应回复代理（屏蔽平台富媒体差异）
  reply(content: string | object, options?: {
    quote?: boolean;
    markdown?: boolean;
    fallbackToImage?: boolean;
  }): Promise<any>;

  // 4. 原生底层引用（仅在特殊需要时透传）
  rawEvent: any;
}
```

### 2.2 中央：部署人员配置与动态路由（`config/namespaces.yaml`）
```yaml
# 机器人部署运维人员（Deployer）自定义的游戏命令空间配置
namespaces:
  zzz:
    prefix: "*"                # 触发符号：用户输入 "*便签"、"*面板"
    aliases: ["zzz", "绝区零"]  # 辅助别名：用户输入 "zzz便签" 亦可触发
    priority: 100              # 优先级
    allow_bare_keywords: false # 是否允许群内无符号直发纯词（如直接发 "便签"）

  hsr:
    prefix: "*"                # 若同为星号，通过二级词区分或由 Hub 提示消歧
    aliases: ["星铁", "崩铁", "hsr"]
    priority: 90

  wuwa:
    prefix: "/"                # 鸣潮部署员偏好使用斜杠 "/"
    aliases: ["鸣潮", "wuwa"]
    priority: 80
```

### 2.3 北向：游戏业务插件清单契约（`IGamePluginManifest`）
游戏插件开发者**只声明纯语义词元，不包含任何前缀符号**：
```typescript
export interface IGameRoute {
  id: string;                  // 路由唯一标识，如 "daily-note"
  tokens: string[];            // 纯指令词元列表，如 ["便签", "体力", "每日", "note"]
  hasArgs?: boolean;           // 是否接受后续参数（如 "面板 简"）
  action: (context: IGameContext) => Promise<void | boolean | string>;
  description: string;         // 指令功能描述（供动态生成帮助菜单使用）
}

export interface IGamePluginManifest {
  gameId: string;              // 唯一游戏标识，如 "zzz"
  name: string;                // 显示名称，如 "绝区零"
  community: string;           // 声明依赖的底层驱动 ID，如 "mihoyo"
  routes: IGameRoute[];        // 纯指令路由集合
}
```

### 2.4 东向：社区驱动 SPI 接口契约（`ICommunityProvider`）
底层社区驱动（如米游社、库街区）必须实现的标准化行为规范：
```typescript
export interface ICommunityProvider {
  id: string;                  // 'mihoyo' | 'kuro'
  name: string;                // '米游社' | '库街区'

  // 1. 登录与身份流
  auth: {
    createQrCode(): Promise<{ qrUrl: string; ticket: string; imgBase64?: string }>;
    pollQrStatus(ticket: string): Promise<{
      status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
      credentials?: { token: string; cookies?: Record<string, string>; uid?: string };
    }>;
    refreshCredentials(credentials: any): Promise<boolean>;
  };

  // 2. 游戏角色拉取
  roles: {
    fetchGameRoles(credentials: any): Promise<Array<{
      gameId: string;          // 'zzz' | 'hsr' | 'genshin' | 'wuwa'
      uid: string;
      region: string;
      nickname: string;
      level: number;
    }>>;
  };

  // 3. 标准网络网关（自动注入动态签名 DS、设备指纹 FP 与 Cookie）
  client: {
    request(options: {
      url: string;
      method?: 'GET' | 'POST';
      query?: Record<string, any>;
      body?: any;
      credentials?: any;
      signType?: 'ds1' | 'ds2' | 'kuro-sign';
    }): Promise<any>;
  };
}
```

---

## 三、 中央调度器（Dispatcher）执行时序模型

```text
[用户发送消息] -> "/便签" 或 "*面板 简"
       │
       ▼
[Game-Hub Inbound Middleware] (Priority: -1000)
       │ 1. 包装为 IUnifiedEvent，计算统一用户 ID ("qq:123456")，剥离 @Bot 标记
       │ 2. 遍历加载好的部署员命名空间表 (namespaces.yaml)
       ▼
[动态命名空间匹配]
       ├── 未命中任何游戏前缀/别名 -> 放行给普通插件（如天气、聊天），return false
       └── 成功命中命名空间（如识别出 gameId: "zzz"，剩余命令体: "面板 简"）
              │
              ▼
[提取纯语义指令与参数]
       - Token: "面板"
       - Args:  "简"
       - 在 game-plugin-zzz 的 manifest 中精准定位到 routeId: "panel"
              │
              ▼
[驱动依赖校验 (Community Health Check)]
       - 检查 provider-mihoyo 是否已在 Hub 挂载
       ├── 若未就绪 -> 直接友好回复："已识别绝区零指令，但当前未安装底层米游社驱动(provider-mihoyo)。" (return "return")
       └── 若已就绪 -> 从 Global Identity Vault 中提取当前用户的通行证凭据与 ZZZ UID
              │
              ▼
[装配 IGameContext 并派发]
       - 构造 context = { event: e, uid: "17708598", args: "简", client: provider.client }
       - 异步触发: await route.action(context)
       - 整个调度过程零正则回溯、零外部插件冲突、零假拦截！
```

---

## 四、 跨端统一身份存储模型（Global Identity Vault）

针对多聊天端（QQ、Telegram）与多游戏 UID 的映射，在底层采用轻量级 SQLite / Key-Value 表结构治理：

### 1. 实体关系映射表（E-R）
1. **`channel_identities` 表（渠道身份表）**：
   - `unified_id` (TEXT, PK): `qq:1904107636`、`tg:797397241`；
   - `account_id` (TEXT, FK): 关联的内部中枢主账号 ID。
2. **`community_accounts` 表（通行证凭据表）**：
   - `id` (TEXT, PK): 内部通行证唯一主键；
   - `account_id` (TEXT, FK): 关联的内部中枢主账号 ID；
   - `provider_id` (TEXT): `mihoyo` 或 `kuro`；
   - `credentials_json` (TEXT): 加密存储的 Token、Cookie 与设备指纹数据。
3. **`game_bindings` 表（游戏角色绑定表）**：
   - `id` (INTEGER, PK, AUTOINCREMENT)；
   - `community_account_id` (TEXT, FK)；
   - `game_id` (TEXT): `zzz`、`hsr`、`wuwa`；
   - `game_uid` (TEXT): 游戏内的真实 UID（如 `17708598`）；
   - `is_default` (BOOLEAN): 是否为该游戏的当前活跃主角色。

### 2. 业务价值
- 用户只要在一个平台扫过一次码，在另一个平台输入 `/认领 <UID>` 或扫码后，系统会自动合并到同一中枢主账号下；
- 换平台无需重新登录，绝区零、星铁、鸣潮数据跨端同步。

---

## 五、 分阶段渐进式落地实施路径

为确保当前线上环境的绝对稳定性，并符合 `dev-workflow` 规范，规划三阶段平滑演进：

### 阶段一：规范定型与独立仓库建立（当前完成）
- 确立 `IGamePluginManifest` 与 `ICommunityProvider` 标准契约；
- 创建独立开源工程结构：
  - `game-hub`（微内核中枢与路由调度插件）
  - `provider-mihoyo`（标准米游社底层驱动）
  - `provider-kuro`（标准库洛底层驱动）
  - `game-plugin-zzz`（纯语义绝区零业务插件）

### 阶段二：Game-Hub 微内核开发与双轨兼容垫片（Shim）
- 实现 `Game-Hub` 的入站事件整形（Inbound Shaper）与命名空间分发（Namespace Dispatcher）；
- **开发兼容垫片（Compatibility Shim）**：
  - 在 `Game-Hub` 中模拟提供 `genshin/model/user.js`、`mysApi.js` 的接口桩；
  - 使既有的 `ZZZ-Plugin` 可以零代码修改，直接无缝插在 `Game-Hub` 上运行，验证总线稳定性。

### 阶段三：业务纯指令化重构与完全脱挂
- 将 `ZZZ-Plugin` 中的指令正则彻底替换为 `manifest` 纯语义清单；
- 彻底移除容器内的 `genshin` 目录与 `miao-plugin`，实现纯净度 100% 的极简运行形态。
