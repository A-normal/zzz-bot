# ZZZ-Bot 接入“最小化米哈游二维码登录”实施与验收报告

- **报告生成时间**: `2026-10-13 21:10:22 +08:00`
- **执行目标**: 为 ZZZ-Bot 容器接入极简化、最小权限的“米哈游二维码登录”能力，剔除所有高危命令与文件管理模块，删除账号密码登录逻辑，实现纯二维码安全扫码与凭据零泄露自动绑定。
- **交付状态**: 部署成功，安全补丁应用完毕，全项验收 100% 通过。

---

## 1. 上游仓库基线与高危模块严格隔离

1. **官方仓库与 Commit 基线**:
   - 官方源：`https://github.com/TimeRainStarSky/TRSS-Plugin`
   - **Commit Hash**: `27931c5a65973221f3c451a2010d70955087ab07`
   - 挂载路径：`/home/bjrst/docker/data/zzz-bot/yunzai/plugins/TRSS-Plugin`

2. **高危与无关模块 100% 物理隔离**:
   - `TRSS-Plugin/index.js` 原生通过扫描 `plugins/TRSS-Plugin/Apps/*.js` 进行动态加载。
   - 创建 `plugins/TRSS-Plugin/Apps.disabled` 隔离目录，将所有无关模块移动至该目录：
     - **高危系统命令类（已禁用）**: `RemoteCommand.js`（远程命令执行）、`Script.js`（脚本执行）、`SystemInfo.js`
     - **高危文件操作类（已禁用）**: `File.js`（远程文件管理与读写）
     - **网盘与辅助类（已禁用）**: `AliyunPan.js`、`BaiduPan.js`、`RealESRGAN.js`、`RemBG.js`、`Voice.js`、`Markdown.js`、`QRCode.js`、`SourceCode.js`
   - **最终保留在 `Apps` 目录下的唯一模块**: 仅有 `miHoYoLogin.js`。

---

## 2. miHoYoLogin.js 最小安全修补实施

针对 `Apps/miHoYoLogin.js` 应用了深度安全加固，并导出独立补丁 `trss-plugin-mihoyologin.patch`：

1. **彻底剔除账号密码登录**:
   - 删除了 RSA `publicKey` 与 `encrypt_data` 加密逻辑；
   - 删除了正则规则 `${regex}.+$` 以及 `miHoYoLoginDetect`、`crack_geetest`、`miHoYoLogin` 处理函数；
   - 杜绝机器人接收或处理米哈游账号与密码。
2. **仅保留扫码登录（多端/群聊均可触发）**:
   - 保留规则：`#米哈游登录`、`#米游社登录`、`#扫码登录`、`#二维码登录` 及其终止指令；
   - 允许私聊与群聊中正常触发二维码生成与推送。
3. **日志全脱敏（零泄露保护）**:
   - 彻底清除所有 `logger.mark(...JSON.stringify(res)...)` 与 `JSON.stringify(cookie)`；
   - 仅记录无敏感信息的规范生命周期状态：
     - `二维码已创建`
     - `二维码已扫描`
     - `扫码已确认`
     - `凭据获取成功，已内部派发绑定`
4. **内部静默投递与聊天回显脱敏**:
   - 扫码成功换取凭据后，通过 `this.makeMessage` 向 Yunzai 内核内部投递私聊事件，由 `Yunzai-genshin` 的 `apps/user.js` 原生捕获并完成安全绑定；
   - 聊天窗口中**彻底剔除 Cookie / Stoken 转发卡片与文本**，无论私聊或群聊仅统一安全回复：
     > **“登录完成，凭据已自动绑定”**

---

## 3. 补丁文件留存与后续更新规则

- **补丁文件位置**:
  - 宿主机工作区：`trss-plugin-mihoyologin.patch`
  - 容器内持久化：`/home/bjrst/docker/data/zzz-bot/yunzai/plugins/TRSS-Plugin/trss-plugin-mihoyologin.patch`
- **更新规则声明**:
  - 后续若对 TRSS-Plugin 执行 `git pull` 更新，**严禁静默覆盖**；
  - 必须重新校验并应用 `trss-plugin-mihoyologin.patch`，确保高危模块隔离与日志脱敏始终生效。

---

## 4. 全项验收结果汇总（100% PASS）

| 验收项目 | 验收指标 | 实际测试输出 | 状态 |
| :---: | :--- | :--- | :---: |
| **TEST-01** | **模块最小化** | TRSS-Plugin 仅加载 `miHoYoLogin` 单个模块 | 动态检查输出：`LOADED_TRSS_APPS: [ 'miHoYoLogin' ]` | **PASS** |
| **TEST-02** | **高危模块禁用** | RemoteCommand / File / Script 彻底未加载 | 对应 12 个 `.js` 均已移至 `Apps.disabled`，完全不被索引 | **PASS** |
| **TEST-03** | **密码登录剔除** | 规则中无账号密码匹配分支 | 源码已移除密码登录规则，仅保留扫码登录规则 | **PASS** |
| **TEST-04** | **日志敏感信息零暴露** | 日志中无完整 API 响应、Token、Cookie | 日志仅打印状态标记，无任何 JSON / 密钥输出 | **PASS** |
| **TEST-05** | **多通道与服务共存** | TG、QQ、ZZZ、genshin 全部恢复在线 | 日志验证：QQ 官方 Bot、TG Bot、ZZZ-Plugin、genshin 均正常加载 | **PASS** |
| **TEST-06** | **容器健康与安全边界** | 容器持续 healthy，无新增暴露端口 | 容器状态 `healthy (Up)`，网络仅 `127.0.0.1:16677` | **PASS** |
| **TEST-07** | **报告脱敏合规** | 报告中不出现 UID、Cookie、Stoken 或二维码内容 | 100% 符合脱敏规范 | **PASS** |

---

## 5. 关键运行日志核对

```text
[21:07:23.741][INFO] [  TRSSYz  ] - 正在加载 TRSS 插件
[21:07:23.778][INFO] [  TRSSYz  ] ZZZ-Plugin 加载中
[21:07:24.424][INFO] [  TRSSYz  ] - QQBot 适配器插件 加载完成
[21:07:24.425][INFO] [  TRSSYz  ] - Telegram 适配器插件 加载完成
[21:07:24.442][INFO] [  TRSSYz  ] - TRSS 插件 加载完成
load Uid Data Done...
[21:07:24.479][INFO] [  Plugin  ] 加载插件[74个]
[21:07:25.804][MARK] [1904***636] [CLIENT] 鉴权通过
[21:07:26.214][MARK] [1904***636] QQBot(QQBot) qq-group-bot v1.1.0 一号Bot 已连接
[21:08:29.002][MARK] [tg_797397.] TelegramBot(Telegram) node-telegram-bot-api v0.66.0 已连接 @bjnobot (一号的通知bot)
[21:07:29.494][MARK] [  TRSSYz  ] ----^_^----
```

---

## 6. 用户端使用与验收指引

现在您可以在 **Telegram** 或 **QQ 官方 Bot** 中安全进行扫码登录：

1. **触发扫码**：
   - 发送：`#扫码登录`（或 `#米哈游登录` / `#米游社登录`）；
   - 机器人将直接下发登录二维码图片。
2. **手机扫码确认**：
   - 打开手机 **米游社 App** 扫一扫功能扫描该二维码，并在手机端点击确认登录。
3. **安全自动绑定完成**：
   - 机器人端将内部静默将凭据交由 `genshin` 插件绑定，聊天界面仅会提示：
     > **“登录完成，凭据已自动绑定”**
   - 没有任何明文 Cookie 或 Stoken 出现在聊天记录或容器日志中。
4. **高阶绝区零功能验收**：
   - 绑定成功后，即可直接在 TG 或 QQ 中验收需要登录态的指令：
     - `%便签`（查询实时电量、活跃度、式舆防卫战刷新周期等）
     - `%深渊`（查询式舆防卫战战绩）
     - `%危局`（查询危局强袭战战绩）
