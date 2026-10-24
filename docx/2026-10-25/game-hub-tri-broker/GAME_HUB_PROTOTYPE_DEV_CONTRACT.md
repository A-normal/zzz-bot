# Game-Hub 核心微内核原型工程开发契约 (Development Contract)

- **版本**: `v1.0.0 (Phase 1 Prototype)`
- **提出时间**: `2026-10-25 00:20:00 +08:00`
- **风险评级**: `MEDIUM`（构建总线抽象核心原型与测试套件，不破坏当前已有容器运行环境）
- **交付目标**: 在代码层面落地 `Game-Hub` 微内核的原型参考实现（Inbound Shaper + Dynamic Namespace Dispatcher + SPI Registry），并提供 100% 自动化测试验证。

---

## 一、 需求与验收标准映射表 (Requirements & Acceptance Criteria)

| 需求标识 (REQ) | 需求描述 | 验收标准 (AC) | 验证手段 (VAL) |
| :--- | :--- | :--- | :--- |
| **REQ-1** | **部署人员动态命名空间配置** | 1. 支持读取 YAML/Object 配置的前缀（如 A部署员配 `*`，B部署员配 `/`）；<br>2. 支持别名（如 `zzz`, `绝区零`）；<br>3. 前缀与别名大小写不敏感匹配。 | `VAL-1` 自动化测试针对不同部署前缀进行解析验证 |
| **REQ-2** | **游戏插件纯指令清单注册与派发** | 1. 游戏插件只声明 `tokens: ['便签', '体力']` 等纯语义词；<br>2. 调度器精准识别主命令与参数（如 `面板 简` -> `token: 面板`, `args: 简`）；<br>3. 彻底阻断任何跨游戏正则抢占。 | `VAL-2` 构造多游戏纯指令清单进行冲突隔离测试 |
| **REQ-3** | **渠道事件输入轻量整形 (Inbound Shaper)** | 1. 统一构造 `unifiedUserId`（如 `qq:123` / `tg:456`）；<br>2. 自动修正 Telegram 缺失的 `@Bot` 判定并剥离 Bot 用户名；<br>3. 抹平 QQ 与 Telegram 的发送参数差异。 | `VAL-3` 模拟不同渠道的 Raw Event 并校验整形后的规范事件 |
| **REQ-4** | **社区驱动 SPI 挂载与缺失友好提示** | 1. 游戏插件声明依赖 `community: 'kuro'` 时，若未挂载 `provider-kuro`，返回明确且友好的安装提示；<br>2. 若已就绪，注入已构造好的 API 客户端上下文。 | `VAL-4` 驱动挂载与缺省熔断测试 |

---

## 二、 任务分解与执行清单 (Ordered Tasks)

- [ ] **TASK-1**：定义基础规范与类型契约 (`lib/game-hub/types.mjs`)
  - 导出 `IUnifiedEvent`, `IGamePluginManifest`, `ICommunityProvider`, `INamespaceConfig` 结构。
- [ ] **TASK-2**：实现西向渠道事件整形器 (`lib/game-hub/inbound-shaper.mjs`)
  - 抹平 NapCat/QQBot/Telegram 差异，规范化用户主键与意图。
- [ ] **TASK-3**：实现社区驱动注册表 (`lib/game-hub/provider-registry.mjs`)
  - 管理已安装的社区驱动（`mihoyo`, `kuro` 等），提供健康检查与上下文注入。
- [ ] **TASK-4**：实现动态命名空间调度微内核 (`lib/game-hub/dispatcher.mjs`)
  - 动态编译路由树，前缀精准剥离，纯语义提取与派发。
- [ ] **TASK-5**：编写完整的微内核端到端自动化测试套件 (`tests/game-hub-prototype.test.mjs`)
  - 覆盖场景：部署员A(`*`) vs 部署员B(`/`)、多游戏隔离、缺失驱动友好提示、跨渠道事件整形。
- [ ] **TASK-6**：运行本地自动化测试并验证所有断言 100% 通过。
