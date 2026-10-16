# Yunzai-genshin 官方插件无损替换与系统复原验收报告

- **报告生成时间**: `2026-10-13 20:26:20 +08:00`
- **执行目标**: 执行 Yunzai-genshin 官方插件的无损替换，移出历史 Mock 桩代码，恢复完整的游戏 UID 绑定模块与 NoteUser 数据管理能力，同时确保 Telegram、QQBot 与 ZZZ-Plugin 双通道无报错恢复在线。
- **交付状态**: 替换完成，依赖完整，全项验收 100% 通过。

---

## 1. 替换与原子操作记录

1. **持久化根目录**:
   - `/home/bjrst/docker/data/zzz-bot/yunzai`
2. **历史 Mock 桩代码原子备份（保留未删除）**:
   - 目标路径：`/home/bjrst/docker/data/zzz-bot/yunzai/plugins/genshin.mock-backup-20261013-201657`
   - 包含文件：原 Phase 2 创建的 `model/user.js`、`model/mys/mysApi.js`、`model/mys/NoteUser.js` 临时桩文件。
3. **官方仓库检出与目录更名**:
   - 官方仓库：`https://github.com/TimeRainStarSky/Yunzai-genshin.git`（depth=1）
   - 临时目录：`/home/bjrst/docker/data/zzz-bot/yunzai/plugins/genshin.official.new`
   - 成功检出后原子移动至标准插件目录：`/home/bjrst/docker/data/zzz-bot/yunzai/plugins/genshin`
   - **检出 Commit Hash**: `4a2e1fb8f094b2a8f039ce0768773701718b60b9`
4. **底层架构依赖适配（无任何 Mock 桩）**:
   - TRSS-Yunzai v3.1.3+ 架构的 `package.json` 原生声明了子路径映射 `imports: { "#miao": "./plugins/miao-plugin/components/index.js" }`，`genshin` 插件的 `model/base.js` 原生依赖该模块。
   - 依官方推荐规范同步就绪官方 `miao-plugin`，使 `genshin` 插件原生模型无缝加载，**未创建任何新的 Mock 或兼容桩**。
5. **系统与配置零改动**:
   - 未修改 `zzz.yml`；
   - 未修改端口映射与网络配置；
   - 未修改现有 Telegram Token 与 QQ 开放平台凭据配置。

---

## 2. 全项验收结果汇总

| 验收编号 | 验收项 | 预期标准 | 实际检测结果 | 状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TEST-01** | **历史桩原子备份** | 原 `plugins/genshin` 备份为时间戳目录，禁止删除 | 备份至 `plugins/genshin.mock-backup-20261013-201657`，完整保留 | **PASS** |
| **TEST-02** | **官方仓库 Commit 记录** | depth=1 检出并记录 git rev-parse HEAD | Commit: `4a2e1fb8f094b2a8f039ce0768773701718b60b9` | **PASS** |
| **TEST-03** | **用户绑定模块加载** | 用户绑定 (`apps/user.js`) 与数据引擎就绪 | 日志明确输出：`load Uid Data Done...`，UID 数据引擎正常启动 | **PASS** |
| **TEST-04** | **零 Import / Module 错误** | 启动日志中无任何 ES Module / 依赖缺失报错 | 插件总数提升至 **73个**（全量加载），控制台 0 报错 | **PASS** |
| **TEST-05** | **QQ 官方 Bot 通道恢复** | 开放平台鉴权通过，WSS Gateway 正常连接 | `[CLIENT] 鉴权通过` -> `QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接` | **PASS** |
| **TEST-06** | **Telegram Bot 通道恢复** | 长轮询正常连接，Bot 身份正常 | `node-telegram-bot-api v0.66.0 已连接 @bjnobot (一号的通知bot)` | **PASS** |
| **TEST-07** | **ZZZ-Plugin 正常运转** | 绝区零插件正常加载，工具 Handler 注册 | `[ZZZ-Plugin] 加载中`，面板工具 `zzz.tool.panel` 注册成功 | **PASS** |
| **TEST-08** | **容器健康与安全约束** | 容器持续 healthy，敏感信息脱敏 | 容器状态 `healthy (Up)`，未记录任何 UID、Cookie、Token | **PASS** |

---

## 3. 容器启动核心日志核对

```text
[20:25:22.063][INFO] [   Redis  ] Done loading RDB, keys loaded: 42, keys expired: 0.
[20:25:23.068][INFO] [  Plugin  ] 加载插件中...
[20:25:23.216][INFO] [  TRSSYz  ] ZZZ-Plugin 加载中
[20:25:23.354][INFO] [  TRSSYz  ] - 正在加载 QQBot 适配器插件
[20:25:23.540][INFO] [  TRSSYz  ] - 正在加载 Telegram 适配器插件
[20:25:23.689][MARK] [  TRSSYz  ] [Handler][Reg]: [ZZZ-Plugin][zzz.tool.panel]
[20:25:23.689][MARK] [  TRSSYz  ] [Handler][Reg]: [ZZZ-Plugin][zzz.tool.panelList]
[20:25:23.755][INFO] [  TRSSYz  ] - QQBot 适配器插件 加载完成
[20:25:23.756][INFO] [  TRSSYz  ] - Telegram 适配器插件 加载完成
load Uid Data Done...
[20:25:23.826][INFO] [  Plugin  ] 加载定时任务[3个]
[20:25:23.826][INFO] [  Plugin  ] 加载插件[73个]
[20:25:25.367][MARK] [1904***636] [CLIENT] 鉴权通过
[20:25:25.472][MARK] [1904***636] [CLIENT] 连接成功
[20:25:25.822][MARK] [1904***636] QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接
[20:25:26.495][MARK] [tg_797397.] TelegramBot(Telegram) node-telegram-bot-api v0.66.0 已连接 @bjnobot (一号的通知bot)
[20:25:26.496][INFO] [ WebSocket] 连接地址：ws://localhost:2536/ [GSUIDCore,OPQBot,ComWeChat,OneBotv11]
[20:25:26.496][MARK] [  TRSSYz  ] ----^_^----
```

---

## 4. 结论与下一步交互建议

- 本次无损替换彻底消除了缺少 `Yunzai-genshin` 导致的指令无法路由问题。
- 用户绑定模块（`apps/user.js`）现已完整激活上线。
- **现在可以按计划在 Telegram 中向 `@bjnobot` 依次发送指令**：
  1. `#绝区零绑定UID`（此时机器人将提示您发送绑定的绝区零 UID）；
  2. 发送您的绝区零游戏 UID；
  3. `#绝区零uid`（查看当前绑定的 UID）；
  4. `%更新展柜面板`（通过 Enka 接口拉取游戏内展柜并出图）；
  5. `%面板列表`（查看展示面板）；
  6. 发送 `#绑定用户`（生成双端绑定口令），再在 QQ 中向机器人发送生成的确认指令，即可打通 QQ 与 TG 的数据互通。
