# QQBot WebSocket 掉线与重连机制深度分析及更新方案报告

- **报告生成时间**: `2026-10-16 12:45:00 +08:00`
- **任务目标**:
  1. 排查并分析 `zzz-bot` 容器当前 QQBot 掉线但 Telegram 渠道持续正常的根本原因。
  2. 审计 `qq-group-bot` 底层 WebSocket 会话管理、鉴权交互与重连控制逻辑，明确是否属于“重试失败后直接放弃”。
  3. 评估用户提出的“间隔 2min 重试 20 次”防御网络波动方案的可行性与优化点。
  4. 制定详细、可落地且防回归的系统更新方案与补丁设计。

---

## 一、 现场日志与运行状态审计（证据链排查）

通过对 Docker 容器 `zzz-bot`（TRSS-Yunzai + 内置 Valkey + QQBot-Plugin + Telegram-Plugin）的全局运行时日志及 `error.log` 进行全量检索与时序复现，还原掉线现场：

### 1.1 时序事件记录表

| 时间戳 (2026-10-16) | 事件主体 | 事件级别 | 核心日志内容摘要 | 状态解析 |
| :--- | :--- | :---: | :--- | :--- |
| **18:58:18** | `1904107636` | MARK/INFO | `[CLIENT] 鉴权通过` -> `连接成功` -> `已连接` | QQBot 初始化建立 WSS 长连接成功 |
| **19:58:18** | `1904107636` | ERRO/MARK | `发生错误：4009 连接过期，请重连` -> `尝试次数：1` -> `连接成功` | 腾讯官方网关常规 60min 会话轮换，1.1 秒内秒级恢复 |
| **20:58:18** | `1904107636` | ERRO/MARK | `发生错误：4009 连接过期，请重连` -> `尝试次数：1` -> `连接成功` | 网关常规会话轮换，1.2 秒内秒级恢复 |
| **21:58:19** | `1904107636` | ERRO/MARK | `发生错误：4009 连接过期，请重连` -> `尝试次数：1` -> `连接成功` | 网关常规会话轮换，1.0 秒内秒级恢复 |
| **22:58:20** | `1904107636` | ERRO/MARK | `发生错误：4009 连接过期，请重连` -> `尝试次数：1` -> `连接成功` | 网关常规会话轮换，1.2 秒内秒级恢复 |
| **23:04:03** | `1904107636` | ERRO/MARK | `[CLIENT] 重新连接中，尝试次数：1`<br>`[CLIENT] 发生错误：1006 未知错误` | **突发网络抖动**：TCP/WS 异常中断（1006 abnormal closure） |
| **23:04:08.490** | `unhandled.` | ERRO | `AxiosError: Client network socket disconnected before secure TLS connection was established` (`ECONNRESET`) | **致命断点**：重连拉取 Access Token 时网络尚未就绪，Axios 抛出未捕获异常 |
| **23:04:08 ~ 至今** | `1904107636` | 无 | **无任何重试尝试、无后续心跳、无任何重连动作** | **QQBot 彻底冻结处于“僵尸态”** |
| **12:26:01** | `tg_797397.` | INFO | `好友消息：[一号-bj184829(tg_7390688139)] %帮助` -> 正常渲染出图响应 | Telegram 渠道持续健康活跃 |

---

## 二、 核心问题定位与深度机理剖析

### 2.1 为什么 Telegram 正常，而 QQBot 永久掉线？
1. **通信架构差异**:
   - **Telegram-Plugin**: 采用 HTTP 轮询模式（Long-Polling，基于 `node-telegram-bot-api` 的 `getUpdates` 接口）。虽然在 10:19 及 12:25 也曾遭遇网络波动导致的 TLS 异常，但轮询模块在 `catch` 到网络错误后会自动等待数秒后发起下一轮 `getUpdates` 请求，具备**天然的故障自愈力**。
   - **QQBot-Plugin / qq-group-bot**: 采用 **WSS Gateway 长连接 + OpenAPI HTTP 鉴权交互** 混合架构。一旦底层连接管理逻辑中断，将直接脱机。

### 2.2 是“重试失败后直接放弃了”吗？
**结论：不仅是“放弃”，而是更严重的“重试首轮未处理异常导致的 Promise 永久死锁（挂起）”。**

通过对底层依赖库 `/root/Yunzai/node_modules/qq-group-bot/lib/sessionManager.js` 源码进行静态审计，发现 4 处底层致命缺陷：

#### 缺陷 1：`getToken()` 缺失 `.catch()` 导致 Promise 永久挂起
在 `sessionManager.js` 第 63 行：
```javascript
const getToken = () => {
    return new Promise((resolve, reject) => {
        axios_1.default.post("https://bots.qq.com/app/getAppAccessToken", {
            appId: appid,
            clientSecret: secret
        }).then(res => {
            if (res.status === 200 && res.data && typeof res.data === "object") {
                resolve(res.data);
            } else {
                reject(res);
            }
        }); // <- 此处缺失 .catch() 异常捕获！
    });
};
```
- **机理**：当网络出现抖动（如 `Client network socket disconnected`、`ECONNRESET`、`ETIMEDOUT`）时，`axios.post()` 返回的 Promise 被 rejected。
- 由于没有附加 `.catch(reject)`，该异常不仅被 Node.js 抛为全局 `unhandledRejection`，而且包装外层的 `new Promise` **既未 resolve 也未 reject，状态永远停滞在 pending**！
- 导致上层的 `await getToken()` -> `await this.getAccessToken()` -> `await this.checkNeedToRestart()` -> `this.start()` 陷入**永久异步等待（挂死）**。
- 这正是为什么日志在 `尝试次数：1` 之后**再也没有触发第 2 次重试**的根本原因！

#### 缺陷 2：`getWsUrl()` 同样缺失 `.catch()`
在 `sessionManager.js` 第 88 行：
```javascript
async getWsUrl() {
    return new Promise((resolve) => {
        this.bot.request.get("/gateway/bot", { ... }).then(res => {
            if (!res.data) throw new Error("获取ws连接信息异常");
            this.wsUrl = res.data.url;
            resolve();
        }); // <- 同样缺失 .catch()！
    });
}
```
- 若在获取 WSS Gateway 地址时网络受阻，同样会永久挂起。

#### 缺陷 3：断线重连采用“零间隔（0ms）同步触发”，无退避机制
在 `SessionEvents.DISCONNECT` 监听器中：
```javascript
case constans_1.SessionEvents.DISCONNECT:
    if (this.userClose || [4914, 4915].includes(data.code)) return;
    if (this.retry < (this.bot.config.maxRetry || exports.MAX_RETRY)) {
        this.bot.logger.mark("[CLIENT] 重新连接中，尝试次数：", this.retry + 1);
        ...
        this.start(); // <- 0 延迟直接执行 start()！
        this.retry += 1;
    }
```
- 一旦网络波动导致 WS 断开，代码在 **0 毫秒** 内立即尝试重启连接。
- 此时本地网络栈、路由器或运营商 DNS 往往尚未恢复（通常需要几秒到一两分钟）。
- 立即重试极易在最虚弱的时刻撞上网络不可达，并在几百毫秒内耗尽所有重试计数，或直接触发未捕获的 HTTP 错误挂死。

#### 缺陷 4：缺乏重连间隔配置支持（缺少 `retryInterval`）
- `qq-group-bot` 原生未定义重试间隔时间，不支持任何间隔重试配置。
- 当前 `config/QQBot.yaml` 配置了 `maxRetry: .inf`，在 YAML 解析为 `Infinity`，但由于无重试间隔且存在挂起 Bug，无限重试完全形同虚设。

---

## 三、 用户方案评估（“间隔 2min 重试 20 次”）

用户的建议：**“间隔 2min 重试 20 次，防止网络波动问题”**。

### 3.1 方案优点与适应性分析
1. **时间跨度覆盖充分**：
   - `20 次 × 2 分钟 = 40 分钟` 容错恢复窗口。
   - 充分覆盖家庭/普通网络环境下宽带重拨号（PPPoE）、路由器重启、Wi-Fi 瞬断、代理软件节点切换等绝大多数网络波动场景。
2. **避免流量风暴与平台风控**：
   - 2 分钟间隔避免了高频请求腾讯开放平台鉴权接口，杜绝了触发开放平台 API 频控封禁（429 Too Many Requests）的风险。

### 3.2 关键业务细节优化（必须区分场景）
在实施“间隔 2min 重试 20 次”时，**必须对断开类型做细分处理**，不可一刀切全部等待 2 分钟：
1. **场景 A：常规网关到期轮换（Code 4009）**：
   - 腾讯官方网关按设计要求客户端**每 60 分钟**重新刷新连接（`4009 连接过期，请重连`，携带 `resume: true`）。
   - **优化策略**：4009 属于正常的日常轮换，首选**快速恢复（1秒重连）**，以确保用户在日常聊天中感知不到掉线；只有当快速重连遭遇网络异常失败时，才转入 2 分钟间隔重试序列。
2. **场景 B：突发网络异常断开（Code 1006 / 错误 / 网络断开）**：
   - 执行用户的指定策略：**等待 2 分钟，按 20 次重试阶梯执行**。
3. **场景 C：连接恢复成功（`READY` 事件）**：
   - 必须立即将 `this.retry` 归零（`retry = 0`），确保下次出现网络波动时仍然拥有完整的 20 次机会。

---

## 四、 详细更新与实施方案

### 4.1 方案设计路线（插件层 Monkey-Patch 方案）

经综合对比直接修改 `node_modules` 与在 `QQBot-Plugin` 中热补丁重写：
- **推荐策略**：在 `/root/Yunzai/plugins/QQBot-Plugin/index.js` 顶部注入补丁，重写 `SessionManager.prototype` 的核心方法。
- **核心收益**：
  1. 完全不受后续容器重启或 `pnpm` 重装依赖的影响（持久化保存在 Git 跟踪的代码目录中）。
  2. 复用该插件已有的补丁模式（原插件顶部已对 `QQBot.Message.parse` 进行过同样的安全 Monkey-Patch）。
  3. 彻底修复 `getAccessToken` 与 `getWsUrl` 的 Promise 悬挂，加入定时器与重试退避。

### 4.2 补丁核心逻辑伪代码/实现设计

```javascript
import { SessionManager } from "qq-group-bot/lib/sessionManager.js"

// 1. 彻底修复 getAccessToken：加入超时与全局 try-catch，禁止挂起
SessionManager.prototype.getAccessToken = async function() {
  const { secret, appid } = this.bot.config
  try {
    const res = await axios.post("https://bots.qq.com/app/getAppAccessToken", {
      appId: appid,
      clientSecret: secret
    }, { timeout: 15000 })
    
    if (res.status === 200 && res.data && res.data.access_token) {
      this.access_token = res.data.access_token
      if (this.tokenTimer) clearTimeout(this.tokenTimer)
      this.tokenTimer = setTimeout(() => {
        this.getAccessToken().catch(e => this.bot.logger.error("Token刷新异常:", e.message))
      }, (res.data.expires_in - 60) * 1000)
      return res.data
    }
    throw new Error("Token响应非200")
  } catch (err) {
    this.bot.logger.error("[CLIENT] 获取 AccessToken 失败:", err.message)
    throw err
  }
}

// 2. 彻底修复 getWsUrl：加入超时与异常捕获
SessionManager.prototype.getWsUrl = async function() {
  try {
    const res = await this.bot.request.get("/gateway/bot", { timeout: 15000 })
    if (!res.data?.url) throw new Error("获取ws连接信息异常")
    this.wsUrl = res.data.url
  } catch (err) {
    this.bot.logger.error("[CLIENT] 获取 Gateway WS 失败:", err.message)
    throw err
  }
}

// 3. 重写重连调度调度器（支持 2min 间隔，20次重试）
SessionManager.prototype.scheduleReconnect = function(delay, isCode4009 = false) {
  if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
  const maxRetry = this.bot.config.maxRetry ?? 20
  const retryInterval = this.bot.config.retryInterval ?? 120000 // 默认 2 分钟

  if (this.retry >= maxRetry) {
    this.bot.logger.error(`[CLIENT] 已达到最大重试次数 ${maxRetry}，停止重连`)
    return
  }

  const waitTime = isCode4009 && this.retry === 0 ? 1000 : retryInterval
  this.bot.logger.mark(`[CLIENT] 将在 ${waitTime / 1000} 秒后进行第 ${this.retry + 1}/${maxRetry} 次重连尝试...`)

  this.reconnectTimer = setTimeout(async () => {
    try {
      this.retry += 1
      await this.start()
    } catch (e) {
      this.bot.logger.error(`[CLIENT] 第 ${this.retry} 次重试连接异常:`, e.message)
      // 异常继续进入调度器重试，绝不挂死
      this.scheduleReconnect(retryInterval, false)
    }
  }, waitTime)
}
```

### 4.3 配置文件配置标准变更

在宿主机挂载的 `/home/bjrst/docker/data/zzz-bot/yunzai/config/QQBot.yaml` 中更新参数：

```yaml
bot:
  sandbox: false
  maxRetry: 20            # 用户指定：最多重试 20 次
  retryInterval: 120000   # 用户指定：重试间隔 2 分钟 (120,000ms)
  timeout: 30000
```

---

## 五、 实施计划与验证步骤

1. **第 1 步：配置项注入**：
   - 在 `config/QQBot.yaml` 中显式声明 `maxRetry: 20` 与 `retryInterval: 120000`。
2. **第 2 步：构建安全 Patch 并打入 `QQBot-Plugin`**：
   - 编写补丁脚本，将带 Promise 防死锁及 2min 延时重试的 `SessionManager` 注入 `plugins/QQBot-Plugin/index.js`。
3. **第 3 步：非中断式重启与状态复验**：
   - 重启容器，核验鉴权恢复、WS 连接恢复与 Telegram 通道共存状态。
4. **第 4 步：故障恢复验证**：
   - 测试模拟网络断开，观察日志是否按预期提示：“将在 120 秒后进行第 1/20 次重连尝试”，并在网络恢复后顺利重连。

---

## 六、 结论

1. **掉线真相**：QQBot 掉线不是因为重试失败后主动放弃，而是因为在突发网络波动（1006）后的第 1 次重连中，底层 `getAppAccessToken` 遭遇 TLS 重置异常；由于代码中缺少 `.catch()`，导致 Promise 永久挂死，重连机制无法流转至第 2 次重试。
2. **用户方案完全可行且必要**：用户建议的“间隔 2min 重试 20 次”不仅契合网络波动的恢复规律，而且有效防止平台封禁与频繁重连震荡。
3. **修复重点**：在实施 2min 间隔 20 次重试的同时，必须补全底层 HTTP 调用的异常捕获与 Promise 防挂死保护，方可彻底解决每天掉线需重启的问题。
