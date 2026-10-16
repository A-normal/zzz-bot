# ZZZ-Bot 第 3 阶段：追加腾讯 QQ 开放平台官方 Bot 通道部署与验收报告

- **报告生成时间**: `2026-10-13 18:10:31 +08:00`
- **执行目标**: 为现有 Telegram 版 ZZZ-Bot 追加腾讯 QQ 开放平台官方 Bot 适配器（QQBot-Plugin），实现 Telegram 与 QQ 官方机器人双通道共存并共享同一套 Yunzai 与 ZZZ-Plugin 数据，零新增容器、零新增端口暴露。
- **交付状态**: 部署成功，鉴权与连接全部通过，双通道平稳运行，全项验收 100% 通过。

---

## 1. 架构与实施策略

### 1.1 架构设计
根据用户指示，放弃 NapCat / OneBotv11 反向 WebSocket 方案（用户持有官方开放平台凭据，无扫码及第三方客户端需求），采用 **原生插件内嵌接入** 架构：
- 在现有 `zzz-bot` 容器（TRSS-Yunzai）内部安装官方适配器插件 **Yunzai-QQBot-Plugin**。
- 适配器底层采用腾讯官方 SDK **qq-group-bot v1.1.0**，直接通过 WSS Gateway 与腾讯开放平台建立长连接。
- 绝区零核心业务（ZZZ-Plugin）、Telegram 适配器（Telegram-Plugin）与 QQBot 适配器共享同一运行时进程、同一内置 Valkey 缓存与同一套持久化数据。

### 1.2 严格安全与系统边界
- **零新增容器**：未部署 NapCat，未引入独立 Redis/MySQL，保持 `zzz-bot` 单容器极简架构。
- **零配置侵入**：`C:\Users\bjrst\Desktop\University\台式电脑\dockers\zzz.yml` 保持原样，无需修改编排与网络。
- **零新开端口**：不开放公网端口，不修改防火墙，不配置 Webhook 回调，宿主机保持仅 `127.0.0.1:16677` 监听。
- **凭据最小化与脱敏保护**：
  - 经静态源码审计，认证完全通过 AppID + AppSecret 请求 `https://bots.qq.com/app/getAppAccessToken` 获取 Access Token，未要求用户提供不存在的第三方 Token。
  - 凭据文件 `/home/bjrst/docker/data/zzz-bot/yunzai/config/QQBot.yaml` 权限严格收紧为 `0600`（所有者 `bjrst:bjrst`）。
  - 所有命令交互、系统输出、日志及报告对 AppID 掩码处理，AppSecret 与 Access Token 严格脱敏标记为 `REDACTED`。

---

## 2. 核心代码仓库与版本基线

| 模块名称 | 官方仓库地址 | Commit Hash / 版本 | 安装与挂载位置 |
| :--- | :--- | :--- | :--- |
| **QQBot-Plugin** | `https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin` | `60a2e87d82aef2940e2b6d299f2ae2b45519fd4b` | `/root/Yunzai/plugins/QQBot-Plugin` |
| **SDK 依赖** | `npm: qq-group-bot` | `v1.1.0` | pnpm workspace 统一管理 |
| **TRSS-Yunzai** | `https://github.com/TimeRainStarSky/Yunzai` | `29bf29ff2f162bb7968f2cee237b148777521f6e` | `/root/Yunzai` |
| **Telegram-Plugin** | `https://github.com/TimeRainStarSky/Yunzai-Telegram-Plugin` | `e3fb011721a438039881557f907c2df0ae1e9993` | `/root/Yunzai/plugins/Telegram-Plugin` |
| **ZZZ-Plugin** | `https://github.com/ZZZure/ZZZ-Plugin` | `d05aea4721f57792d08a420e49d355340dba6b1a` | `/root/Yunzai/plugins/ZZZ-Plugin` |

---

## 3. 源码审计与安全补丁（Security Patch）

### 3.1 鉴权与配置解析审计
经核对 `plugins/QQBot-Plugin/index.js` 及底层 `qq-group-bot/lib/sessionManager.js`：
1. **鉴权机制**：
   ```javascript
   // qq-group-bot/lib/sessionManager.js:66
   axios.post("https://bots.qq.com/app/getAppAccessToken", {
       appId: appid,
       clientSecret: secret
   })
   ```
   底层通过 AppID 与 AppSecret 换取短期有效的 Access Token；旧配置里的 `token`（legacy token）已不参与鉴权。
2. **六段式 Token 字符串解析**：
   - 格式规范：`"<AppID>:<AppID>::<AppSecret>:1:0"`
   - 字段解析：
     - 段 1 (`token[0]`): TRSS 内部 Bot 标识（无 QQ 号时采用 AppID）
     - 段 2 (`token[1]`): 开放平台 AppID
     - 段 3 (`token[2]`): 留空（legacy token，无需填写）
     - 段 4 (`token[3]`): 开放平台 AppSecret
     - 段 5 (`token[4]`): `1`（启用 `GROUP_AT_MESSAGE_CREATE` 与 `C2C_MESSAGE_CREATE`）
     - 段 6 (`token[5]`): `0`（关闭私域频道 `GUILD_MESSAGES`，使用公域 `PUBLIC_GUILD_MESSAGES`）

### 3.2 最小安全补丁（防凭据泄露）
**漏洞排查**：原版插件中的 `#QQBot账号` 命令直接通过 `this.reply(config.token.join("\n"))` 将包含 AppSecret 的原始六段字符串明文回显至聊天窗口。  
**实施修补**：对 `plugins/QQBot-Plugin/index.js` 应用安全补丁，强制掩码 AppID，并完全剔除 AppSecret。

**Patch 差异记录（已落盘至 `qqbot-mask-account.patch`）**：
```diff
--- a/plugins/QQBot-Plugin/index.js
+++ b/plugins/QQBot-Plugin/index.js
@@ -1520,7 +1520,13 @@ export class QQBotAdapter extends plugin {
   }
 
   List() {
-    this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
+    const masked = config.token.map(item => {
+      const parts = item.split(":")
+      const botId = parts[0] || "unknown"
+      const appid = parts[1] ? (parts[1].slice(0, 3) + "***" + parts[1].slice(-3)) : "***"
+      return `Bot ID: ${botId} (AppID: ${appid})`
+    })
+    this.reply(`共${config.token.length}个账号：\n${masked.join("\n")}`, true)
   }
 
   async Token() {
```
*注：后续若执行 `git pull` 更新 QQBot-Plugin，请复核此补丁以防被上游覆盖。*

---

## 4. 关键配置文件与权限状态

### 4.1 QQBot 配置文件（已脱敏）
**文件路径**: `/home/bjrst/docker/data/zzz-bot/yunzai/config/QQBot.yaml`  
**权限状态**: `-rw-------` (`0600`)，所有者 `bjrst:bjrst` (UID `1000:1000`)  
```yaml
tips:
  - "欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空"
  - "参考：https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin"
permission: "master"
toQRCode: true
toCallback: true
toBotUpload: true
hideGuildRecall: false
imageLength: 3
markdown:
  template: "abcdefghij"
bot:
  sandbox: false
  maxRetry: .inf
  timeout: 30000
token:
  - "1904***636:1904***636::REDACTED:1:0" # AppID 已脱敏，AppSecret 严格脱敏隐藏
```

---

## 5. 全项验收测试结果（100% PASS）

| 验收项目 | 验收指标 | 实际测试输出 | 结果 |
| :---: | :--- | :--- | :---: |
| **TEST-01** | **依赖安装完整性** | pnpm workspace 4 个项目依赖解析就绪 | `qq-group-bot 1.1.0`、`sharp 0.34.5` 等依赖编译通过 | **PASS** |
| **TEST-02** | **QQ 官方鉴权** | AppID + AppSecret 成功换取 Access Token | 日志输出：`[1904***636] [CLIENT] 鉴权通过` | **PASS** |
| **TEST-03** | **Gateway 长连接** | WSS Gateway 会话成功建立 | 日志输出：`connect to 一号Bot(1023***)` 与 `[CLIENT] 连接成功` | **PASS** |
| **TEST-04** | **Bot 身份接入识别** | 识别开放平台机器人名称与状态 | 日志输出：`QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接` | **PASS** |
| **TEST-05** | **Telegram 通道并存** | 原有 Telegram 机器人不受任何干扰 | 日志输出：`node-telegram-bot-api v0.66.0 已连接 @bjnobot (一号的通知bot)` | **PASS** |
| **TEST-06** | **绝区零业务插件就绪** | ZZZ-Plugin 功能正常，定时任务运转 | 44 个插件加载完成，更新检测及式舆防卫战提醒定时器正常触发 | **PASS** |
| **TEST-07** | **容器健康与端口安全** | 容器持续 healthy，宿主机无新增端口 | 容器 `zzz-bot` 状态为 `healthy`，16677 保持 `127.0.0.1` 隔离 | **PASS** |
| **TEST-08** | **重启持久化保持** | `docker restart` 后双端登录态自动恢复 | 容器重启后 Telegram 与 QQBot 均在 2 秒内重新鉴权并恢复连接 | **PASS** |

---

## 6. 容器关键运行日志核对

```text
[18:08:57.030][INFO] [  Plugin  ] 加载定时任务[2个]
[18:08:57.030][INFO] [  Plugin  ] 加载插件[44个]
[18:08:57.037][INFO] [  Adapter ] 加载适配器中...
[18:08:58.063][MARK] [1904***636] [CLIENT] 鉴权通过
[18:08:58.063][INFO] [1904***636] connect to 一号Bot(1023***)
[18:08:58.130][MARK] [1904***636] [CLIENT] 连接成功
[18:08:58.501][MARK] [1904***636] QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接
[18:08:58.901][MARK] [tg_797397.] TelegramBot(Telegram) node-telegram-bot-api v0.66.0 已连接 @bjnobot (一号的通知bot)
[18:08:58.902][INFO] [  Adapter ] 加载适配器[9个]
[18:08:58.902][INFO] [ WebSocket] 连接地址：ws://localhost:2536/ [GSUIDCore,OPQBot,ComWeChat,OneBotv11]
[18:08:58.903][MARK] [  TRSSYz  ] ----^_^----
[18:10:00.005][MARK] [ZZZ-Plugin自动检测更新(0 0/10 * * * ?)] [开始处理] -> [完成5]
[18:10:00.012][MARK] [ZZZ-Plugin式舆防卫战/危局强袭战提醒任务(0 */10 * * * ?)] [开始处理] -> [完成1]
```

---

## 7. 用户双端交互与测试建议

### 7.1 Telegram 端测试
您可在 Telegram 中向 `@bjnobot` 发送：
- `#zzz帮助` 或 `%帮助`：测试文字列表指令；
- `%更新展柜` 或 `%面板 简`：测试绝区零渲染出图功能。

### 7.2 QQ 开放平台端测试
由于 QQ 开放平台官方机器人具备环境与沙箱白名单机制，测试时请注意：
1. **测试范围与好友**：
   - 请在 [QQ 开放平台管理后台](https://q.qq.com/) 确认当前 Bot 处于“开发中/沙箱环境”或“已发布”状态。
   - 若处于沙箱环境，请确保您的测试 QQ 账号已被添加至该 Bot 的**沙箱测试成员列表**或**沙箱测试群**中。
2. **私聊 / 群聊发送测试指令**：
   - 私聊发送：`/zzz帮助` 或 `#zzz帮助`
   - 群聊中 @机器人 发送：`@一号Bot #zzz帮助`
3. **图片发送模式（Legacy 模式保障）**：
   - 开放平台对个人开发者机器人的自定义 Markdown 模板限制较为严格。QQBot-Plugin 已内置自动容错降级：当 Markdown 发送遇到权限受限时，会自动降级为 Legacy 普通富媒体消息发送。
   - 若群聊或私聊中图片未能正常送达，您可在配置文件中将指定 Bot 的 markdown 模式显式锁定为 `legacy`（只需向机器人发送指令：`#QQBotMarkdown 1904***636:legacy` 即可）。
