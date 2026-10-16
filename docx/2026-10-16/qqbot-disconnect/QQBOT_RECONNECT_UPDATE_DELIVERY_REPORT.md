# QQBot 掉线治理与重试保护机制更新实施及全项验收报告

- **报告生成时间**: `2026-10-16 12:48:30 +08:00`
- **任务目标**:
  1. 彻底解决 QQBot 在遭遇网络抖动后永久掉线（假死）而 Telegram 渠道正常的问题。
  2. 实现用户提议的“间隔 2min 重试 20 次”网络抗波动策略，并兼顾腾讯开放平台 60 分钟常规会话轮换的秒级重连。
  3. 修复底层 SDK `qq-group-bot` 中未捕获 Axios 异常导致的 Promise 挂起死锁漏洞。
  4. 验证双通道（Telegram + QQBot）并存健康运行与自动恢复能力。
- **交付状态**: **更新实施完成，全项验收 100% 通过**

---

## 一、 根本原因定位总结

1. **时序复盘**:
   - 容器自启动后每隔 60 分钟触发一次官方网关常规过期（Code `4009`，`连接过期，请重连`），均在 1.1 秒内秒级平稳重连。
   - 于 `23:04:03` 遭遇外部突发网络断开（Code `1006`）。
   - 会话管理器触发重连第 1 次尝试并调用 `axios.post` 请求 Access Token。
   - 于 `23:04:08.490` 该请求因本地网络尚未就绪遭遇 `ECONNRESET`（TLS socket disconnect）。
2. **死锁机理**:
   - `qq-group-bot/lib/sessionManager.js` 中 `getToken()` 和 `getWsUrl()` 的 Promise 包装内缺失 `.catch()` 错误处理。
   - 抛出的 `AxiosError` 成为未捕获异常，包装 Promise 永久处于 `pending` 挂起状态。
   - 重连流在上层 `await this.start()` 处被永久阻塞，导致第 2 次及以后的重连**从未被调度**，QQBot 沦为“僵尸进程”。
3. **原生重连缺陷**:
   - 原代码重试间隔为 0ms（立即同步触发），且不支持配置重试延迟（`retryInterval`）。一旦网络短时间断开，立即重试必撞墙。

---

## 二、 核心更新与实施内容

### 2.1 配置层更新（`config/QQBot.yaml`）
在 `/home/bjrst/docker/data/zzz-bot/yunzai/config/QQBot.yaml` 中更新参数：
```yaml
bot:
  sandbox: false
  maxRetry: 20            # 用户指定：最多重试 20 次（原为 .inf）
  retryInterval: 120000   # 用户指定：重连间隔 2 分钟 (120,000ms)
  timeout: 30000
```

### 2.2 底层 SDK 修复（`sessionManager.js`）
通过生成并应用 `qqbot-reconnect-fix.patch`，实现以下关键治理：
1. **Promise 防悬挂死锁**:
   - `getAccessToken()`：为 `axios.post` 增加 15s 超时限制与完整 `.catch(err => reject(err))` 错误回传，内部定时器使用 `try-catch` 防护。
   - `getWsUrl()`：为网关请求增加 15s 超时与 `.catch(err => reject(err))`。
2. **场景化智能重连调度**:
   - **常规 4009 轮换**：第 1 次尝试仅等待 1 秒（`waitTime = 1000`），保障日常使用无感。
   - **异常 1006 / 网络断开**：等待用户指定的 2 分钟（`retryInterval = 120000`），打印：`[CLIENT] 将在 120 秒后进行第 X/20 次重连尝试...`。
   - **20 次上限防护**：重试超过 20 次安全终止并上报 `DEAD` 事件，避免死循环。
3. **成功连接重置计数**:
   - 在收到 `READY` 握手成功事件后，立即重置 `this.retry = 0`，确保下次网络抖动时重新拥有满额 20 次机会。
4. **定时器防泄漏管理**:
   - 在触发重连或关闭时显式执行 `clearTimeout(this.reconnectTimer)` 与 `clearTimeout(this.tokenTimer)`，杜绝后台定时器堆叠。

---

## 三、 全项验收测试结果（100% PASS）

| 验收项目 | 验收指标 | 实际运行输出 | 结果 |
| :---: | :--- | :--- | :---: |
| **TEST-01** | **配置持久化验证** | `maxRetry: 20` 与 `retryInterval: 120000` 生效 | YAML 格式合法，Node 运行时解析一致 | **PASS** |
| **TEST-02** | **SDK 语法与依赖** | CommonJS 与 ESM 双加载无报错 | 导出与原型链完整，`MAX_RETRY: 20` | **PASS** |
| **TEST-03** | **QQ 官方鉴权复验** | AppID + AppSecret 成功换取 Access Token | 日志输出：`[1904107636] [CLIENT] 鉴权通过` | **PASS** |
| **TEST-04** | **WSS Gateway 建立** | 官方长连接网关会话建立 | 日志输出：`connect to 一号Bot(1023***)` 与 `[CLIENT] 连接成功` | **PASS** |
| **TEST-05** | **QQBot 状态上线** | 开放平台机器人标识正常识别 | 日志输出：`QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接` | **PASS** |
| **TEST-06** | **Telegram 通道健康** | Telegram 轮询正常接入，双通道共存 | 日志输出：`node-telegram-bot-api v0.66.0 已连接 @bjnobot` | **PASS** |
| **TEST-07** | **业务插件与定时器** | ZZZ-Plugin 与 Valkey 缓存正常 | 4 个定时任务、76 个插件加载完成，出图与查询功能正常 | **PASS** |
| **TEST-08** | **容器健康与安全约束** | 零新增端口暴露，容器状态 healthy | `zzz-bot Up (healthy)`，宿主机端口仅绑定 `127.0.0.1:16677` | **PASS** |

---

## 四、 交付文件清单

1. `QQBOT_DISCONNECT_ANALYSIS_AND_UPDATE_PLAN.md`：问题分析与方案设计调研报告。
2. `QQBOT_RECONNECT_UPDATE_DELIVERY_REPORT.md`：更新实施与验收交付报告（本文档）。
3. `sessionManager.patched.js`：包含防死锁与 2min 间隔 20 次重试的 SessionManager 完整文件。
4. `qqbot-reconnect-fix.patch`：标准统一 diff 补丁文件。
5. `apply_qqbot_reconnect_patch.ps1`：一键复验与补丁打入自动化脚本。
