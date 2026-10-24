# ZZZ-Bot 已绑定账户无法更新面板问题排查与修复报告

- **时间戳**: 2026-10-22 01:36:00
- **任务目标**: 审查容器日志，定位“已绑定的账户无法更新面板”的核心根因，制定并实施修复方案，确保已绑定 Cookie 的用户在遭遇米游社接口异常时仍能可靠获取和更新角色面板数据。

---

## 1. 任务背景与日志审查

在生产容器 `zzz-bot` 的运行日志（`logs/command.2026-10-22.log` 与 `logs/error.log`）中，发现两类典型的面板更新失败记录：

### 1.1 案例一：UID 17708598（已完成绑定的账户）
- 用户在 `01:08:00` 通过扫码登录指令 `#绑定`（`miHoYoLoginQRCode`）成功获取并保存凭据（`ltuid: 283399052`）。
- 随后在 `01:08:15` 发送 `#更新面板`，后台触发报错：
  ```text
  [01:08:13.772][ERRO] 面板列表更新失败： MysError: UID:17708598，米游社账号异常，暂时无法查询，请发送 %绑定设备帮助 查看如何绑定设备
      at MysZZZApi.checkCode (file:///root/Yunzai/plugins/ZZZ-Plugin/src/lib/mysapi.ts:355:11)
      at refreshPanel (file:///root/Yunzai/plugins/ZZZ-Plugin/src/lib/avatar.ts:113:19)
      at Panel.refreshPanel (file:///root/Yunzai/plugins/ZZZ-Plugin/src/apps/panel.ts:131:13)
  ```
  返回元数据为：`code: 10041, uid: '17708598', result: { data: null, message: '', retcode: 10041, api: 'zzzAvatarList' }`。

### 1.2 案例二：UID 12290264（历史凭据过期）
- `[00:58:44.017][ERRO] 面板列表更新失败： MysError: UID:12290264，米游社cookie已失效, 请重新绑定ck或发送#刷新ck`，返回 `retcode: -100`。

---

## 2. 核心根因分析 (Root Cause Analysis)

在深入分析 `plugins/ZZZ-Plugin/apps/panel.js` 的 `refreshPanel()` 处理链路后，确认以下三大设计缺陷与冲突：

### 2.1 绑定与未绑定的“路由悖论”
- 代码中判断逻辑为：
  ```javascript
  const isEnka = this.e.msg.includes('展柜') || !(await getCk(this.e));
  ```
  - **未绑定 CK 用户**：`!getCk` 为真，默认走 **Enka 展柜接口**。经实测，该用户的 Enka 展柜公开正常，直接返回 6 位代理人面板数据，更新顺畅。
  - **已绑定 CK 用户**：`getCk` 为真，`isEnka` 强制为假，走 **米游社 `zzzAvatarList` 接口**。
- 米游社的 `event/game_record_zzz/api/zzz/avatar/basic` 接口对非真机环境有严格的设备指纹与风控策略（`10041: 账号异常/需要设备验证`）。由于插件默认设备特征被公共共享，米游社大概率拦截此类全量角色请求。已绑定的用户反而因为绑定了 CK 而被分流到必定失败的米游社接口，导致“绑定了反而查不了”。

### 2.2 冷却时间（Cooldown）过早写入
- 原代码在调用 `refreshPanelFunction` **之前**就执行了：
  ```javascript
  await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
  ```
- 当米游社接口抛出 `10041` 异常时，用户已经被锁定 300 秒（5分钟）的更新冷却。
- 即使报错信息提示用户“可尝试发送 /更新展柜面板”，用户紧接着发送该指令时，会立刻被冷却拦截：
  `⏳ 刷新面板冷却中：请在 4分58秒 后再试（避免频繁请求触发风控）`，形成了严重的体验死锁。

### 2.3 缺乏失败降级回退机制（Graceful Degradation）
- 当已绑定账户在调用米游社全量角色接口失败后，没有自动尝试 Enka 展柜降级获取已公开展示的角色数据，直接输出报错中断流程。

---

## 3. 修复方案与实施细节

针对上述根因，对 `plugins/ZZZ-Plugin/apps/panel.js` 实施了以下优化与加固：

1. **移除提前加冷却锁**：
   - 只有在米游社全量刷新成功、或 Enka 展柜刷新成功后，才写入 `ZZZ:PANEL:${uid}:LASTTIME`。
   - 纯 Enka 分支中，也只有在展柜中存在至少 1 位代理人时才设置冷却时间，空展柜不设冷却，方便用户去游戏内调整设置后立即重试。
2. **米游社失败后自动降级 Enka 展柜同步**：
   - 当已绑定用户的米游社请求因风控（10041）、Cookie 失效（-100）或网络波动失败时，不再直接报错退出，而是自动调用 `refreshPanelFromEnka(uid)`。
   - 若 Enka 展柜成功拉取到角色面板，自动合并面板数据并调用 `getPlayerInfo(enkaData.playerInfo)` 补齐玩家名片信息，正常渲染生成面板更新卡片。
   - 渲染完成后向用户追加友好提示：
     `⚠️ 米游社查询受限（${errorMsg.trim()}），已自动通过 Enka 展柜同步公开角色面板！`
3. **双重失败时清晰指引且不锁定冷却**：
   - 若米游社失败且 Enka 展柜也为空或不可用，向用户同时展示米游社与 Enka 状态，且不锁定 5 分钟冷却，指引用户在游戏内公开名片展柜或重新扫码。

---

## 4. 验证与交付

1. **本地单元测试**：
   - 新增 `tests/panel-refresh-fallback.test.mjs`，覆盖了“米游社失败时自动降级 Enka”、“失败不提前加锁”、“展柜为空不加锁”等核心边界，运行结果全部通过（2/2 pass）。
   - 执行全局回归测试（命名空间测试 + AI 路由核心 51 项测试），全部 100% 通过无回退。
2. **线上容器注入与实测验证**：
   - 将修改注入容器 `/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/panel.js`。
   - 在容器内以真实 UID `17708598` 进行全链路模拟执行：
     - 米游社接口拦截后，自动降级至 Enka 展柜；
     - 成功提取 Enka 展柜公开的 6 位代理人（艾莲、耀嘉音、伊芙琳等）；
     - 成功渲染 `panel/refresh.html`，捕获降级提示，且 Redis 冷却键仅在成功后写入。
3. **容器重启与服务巡检**：
   - 清理测试残留冷却键，重启 `zzz-bot` 容器。
   - 容器健康状态正常（`healthy`），TRSS-Yunzai、QQBot 适配器（一号Bot 1023319809146892505）以及 Telegram Bot 均正常联机就绪。
