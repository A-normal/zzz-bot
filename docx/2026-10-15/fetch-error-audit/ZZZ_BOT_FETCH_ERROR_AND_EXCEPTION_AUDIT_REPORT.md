# 绝区零与云崽网络异常处理、错误降级与提示失真深度调研报告

- **报告生成时间**: `2026-10-15 16:55:00 +08:00`
- **任务目标**:
  1. 深度复盘日志中出现的 `ERROR fetch failed`（底层网络连接故障）与用户端提示“米游社接口未返回信息/返回数据为空”之间的严重脱节机理。
  2. 地毯式排查当前项目中类似“吞掉底层错误”、“错误语义偷换”、“二极管式降级提示”的代码缺陷，形成明确的问题清单。
  3. 给出兼顾架构健壮性（Resilience）、精准可诊断性（Observability）与用户体验（UX）的体系化改进方案。

---

## 1. 核心问题定位与全链路还原

### 1.1 现象与矛盾点
在日常运行日志中，频繁观察到如下典型异常序列：

```log
[22:04:49.119][ERRO][ TRSSYz ] TypeError: fetch failed
  [cause]: ConnectTimeoutError: Connect Timeout Error (attempted address: passport-api.mihoyo.com:443, timeout: 10000ms)
    at onConnectTimeout (node:internal/deps/undici/undici:2450:23)
```

然而，在机器人面对群内用户的交互中，回复的内容却是：
**`米游社接口返回数据为空`** 或 **`米游社接口未返回信息`**。

### 1.2 根因机理：错误被错误降级与概念偷换（Fault Masking & Misleading Translation）

通过跟踪代码调用栈，还原出以下三级“逐级失真”链路：

1. **第一级（底层网络请求层 `mysApi.js`）—— 盲目吞异常**：
   在 `plugins/genshin/model/mys/mysApi.js` 的 `getData(type, data)` 中：
   ```javascript
   let response = {}
   try {
     response = await fetch(url, param)
   } catch (error) {
     logger.error(error.toString()) // 仅在控制台打印 TypeError: fetch failed
     return false // 吞掉真实 error 对象，盲目返回 false！
   }
   if (!response.ok) {
     logger.error(`[米游社接口][${type}][${this.uid}] ${response.status} ${response.statusText}`)
     return false // HTTP 403 WAF、429限流、502网关错误全部也归约为 false！
   }
   ```
   **后果**：无论底层是因为 DNS 解析超时、服务器握手失败、被米游社 WAF 防火墙拦截（403），还是米游社服务宕机（502），上层拿到的全都是毫无上下文的 `false`。

2. **第二级（中间适配与校验层 `mysapi.js`）—— 概念偷换与虚假诊断**：
   在 `plugins/ZZZ-Plugin/dist/lib/mysapi.js` 中：
   ```javascript
   const result = await this.getData(type, data, cached); // 得到 false
   const _data = await this.checkCode(result, type, data);
   ```
   随后进入 `checkCode(res)`：
   ```javascript
   async checkCode(res, type, data = {}) {
       if (!res) {
           throw new Error('米游社接口返回数据为空'); // 致命误导！
       }
   ...
   ```
   **后果**：因为拿到的是 `false`，校验函数自作聪明地直接抛出 `Error('米游社接口返回数据为空')`！把根本没有连上服务器的“网络故障”，偷换成了业务层面的“返回数据为空”。

3. **第三级（业务展现层各个 app）—— 生硬转发误导用户**：
   在 `abyss.js`, `deadly.js`, `note.js`, `card.js` 等各个业务插件中：
   ```javascript
   const data = await api.getFinalData(method, ...).catch((e) => {
       this.reply(e.message); // 直接把 "米游社接口返回数据为空" 原样发给群聊
       throw e;
   });
   ```
   **最终后果**：
   - 用户看到提示，完全不知道是网络波动或出海连接超时，反而误以为“自己的号没有数据”、“米游社把数据删了”或“插件解析坏了”。
   - 运维排查困难，业务报错与底层运行状态完全脱节。

---

## 2. 全系统类似问题地毯式审查清单

通过全量代码检索与审查，排查出系统中存在以下 **6 大类共 12 处类似缺陷**：

| 序号 | 所属模块与文件 | 代码缺陷位置 | 原始缺陷代码行为 | 导致的不良后果与用户提示失真 | 严重等级 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `plugins/genshin/model/mys/mysApi.js` | `getData(type, data)` | `catch (error) { logger.error(...); return false; }` | 吞掉所有网络超时（ETIMEDOUT）、连接被拒（ECONNREFUSED）、DNS失败，丢失全部错误上下文。 | **严重** |
| **2** | `plugins/ZZZ-Plugin/dist/lib/mysapi.js` | `checkCode(res)` | `if (!res) throw new Error('米游社接口返回数据为空')` | 将网络故障和 HTTP 403/502 直接伪造成“返回数据为空”，直接导致用户端误解。 | **严重** |
| **3** | `plugins/ZZZ-Plugin/dist/apps/guide.js` | `getImg(name, group)` | `catch (error) { this.e.reply('暂无攻略数据，请稍后再试'); return false; }` | 米游社 BBS 帖子接口网络超时时，机器人直接误导用户“该角色暂无攻略数据”。 | **中等** |
| **4** | `plugins/ZZZ-Plugin/dist/apps/calendar.js` | `calendar()` | `if (!activityList?.data) return this.reply('获取活动列表失败')` | 公告 API 连接失败时未做任何网络重试，回复极其生硬且无指引。 | **中等** |
| **5** | `plugins/ZZZ-Plugin/dist/apps/poolHistory.js` | `fetchData()` | `catch { return this.reply('卡池历史记录数据获取失败') }` | 国内服务器请求 GitHub Raw 抓取卡池历史极易超时，直接提示“卡池历史获取失败”，未指明是 GitHub 数据源网络连通问题。 | **中等** |
| **6** | `plugins/ZZZ-Plugin/dist/apps/panel.js` | `refreshPanel()` / `getCharDetail()` | `.catch(err => err);` 静默捕获 | 单角色拉取详情如果遭遇米游社 429 限流或超时，被当做正常对象吞掉，角色静默缺失，长图中缺失个别角色却无告警。 | **中等** |
| **7** | `plugins/example/zzzSign.js` | `doSign()` | `if (!infoJson || !infoJson.data) return { success: false, msg: "⚠️ 接口未返回数据" }` | 签到查询如果遇到畸形返回或底层代理中断，同样归类为“接口未返回数据”，缺乏区分度。 | **中等** |
| **8** | `plugins/ZZZ-Plugin/dist/utils/request.js` | `_fetch()` | `logger.debug('请求失败：' + (error.name === 'AbortError' ? ...)) ` | 超时使用 debug 日志打印，上层很难拿到详细的 abort 原因，直接抛出 `Retry limit reached`。 | **低** |
| **9** | `plugins/ZZZ-Plugin/dist/apps/gachalog.js` | `getGachaUrl()` | `return this.reply('authKey获取失败，请检查cookie是否过期')` | 只要获取抽卡链接失败，一律判定为“cookie过期”，即使是米游社认证网关 504 超时也是该提示。 | **中等** |
| **10** | `plugins/genshin/apps/user.js` (扫码登录) | `miHoYoLoginQRCode` | `catch (e) { ... [TypeError: fetch failed] }` | 扫码登录轮询 `passport-api.mihoyo.com` 超时时，偶发中断未向用户说明是登录服务器超时。 | **低** |
| **11** | `plugins/ZZZ-Plugin/dist/apps/monthly.js` | `monthly()` | `if (!monthlyResponse) return this.reply('获取月报数据失败，请检查日期是否正确')` | 明明是网络失败或凭据失效，却误导用户“请检查日期是否正确”。 | **中等** |
| **12** | `plugins/ZZZ-Plugin/dist/apps/explorationDetail.js`| `explorationDetail()` | `if (!explorationDetail) return this.reply("暂无探索详情数据")` | 接口超时或未公开，一律回复“暂无探索详情数据”。 | **低** |

---

## 3. 体系化改进方案（Architecture Improvement Plan）

为彻底杜绝“网络故障 -> 伪造成空数据 -> 误导用户”的链式反应，建议采取**分层治理、精准诊断、弹性重试**的改进方案：

```
+-----------------------------------------------------------------------------------+
| 1. 网络传输层 (Network Transport Layer)                                           |
|    - 捕获真实 Fetch / Undici 错误 (ETIMEDOUT, ECONNRESET, ENOTFOUND, HTTP Status)   |
|    - 严禁 return false，封装为标准的 NetworkError / HttpStatusError                |
|    - 增加 1~2 次轻量级指数退避自动重试 (500ms, 1500ms)，吸收偶发网络抖动            |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| 2. 协议与适配层 (MysApi Adapter & CheckCode Layer)                                |
|    - 区分「未连接成功」、「服务报错」、「业务错误码」与「数据真的为空」             |
|    - 只有当 HTTP=200 且 retcode=0 且 data 确属空对象时，才判定为 DATA_EMPTY         |
|    - 网络层抛出的 NetworkError 原汁原味透传，保留 cause 与网络诊断信息             |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| 3. 用户展现与交互层 (UX & Diagnostics Layer)                                       |
|    - 友好的分级提示矩阵：                                                         |
|      * 网络超时/中断 -> "⚠️ 无法连接米游社服务器（网络连接超时），请稍后重试"        |
|      * 凭据失效       -> "⚠️ 米游社凭据已失效，请发送 /绑定 重新扫码"               |
|      * 账号未公开     -> "⚠️ 米游社战绩未公开，请在米游社App中开启「公开展示」"      |
|      * 遇到验证码     -> "⚠️ 遇到安全验证码，请在米游社App中完成滑动验证后重试"      |
|      * 业务真实为空   -> "ℹ️ 查询成功，当前期暂无战斗/战绩数据"                     |
+-----------------------------------------------------------------------------------+
```

### 3.1 核心代码改造建议（落地实施参考）

#### 改造 1：重构 `mysApi.js` 的 `getData()` 错误传递
```javascript
// 修改前：
try {
  response = await fetch(url, param)
} catch (error) {
  logger.error(error.toString())
  return false
}

// 建议改造后：
try {
  response = await fetch(url, param)
} catch (error) {
  logger.error(`[米游社网络请求异常][${type}]: ${error.message}`)
  // 向上抛出明确的 NetworkError，而不是吞掉返回 false
  throw new Error(`连接米游社服务失败（${error.cause?.code || error.message}），请稍后重试`)
}
if (!response.ok) {
  logger.error(`[米游社接口异常][${type}]: HTTP ${response.status}`)
  throw new Error(`米游社服务异常（HTTP ${response.status}），请稍后重试`)
}
```

#### 改造 2：修正 `mysapi.js` 中 `checkCode` 的语义
```javascript
// 修改前：
async checkCode(res, type, data = {}) {
    if (!res) {
        throw new Error('米游社接口返回数据为空');
    }
...

// 建议改造后：
async checkCode(res, type, data = {}) {
    if (!res) {
        throw new Error('米游社服务器未响应或连接中断');
    }
    // 只有在明确拿到米游社响应体后才解析业务 retcode
    res.retcode = Number(res.retcode);
    ...
```

#### 改造 3：业务层统一样式与错误拦截器（Error Interceptor）
在 `ZZZPlugin` 基类中封装统一的 `handleError(e, error)` 方法：
- 识别 `ConnectTimeoutError` / `fetch failed` -> 提示：`⚠️ 无法连接米游社服务器，网络请求超时，请稍后重试。`
- 识别 `1034 / 10035` -> 提示：`⚠️ 触发米游社验证码风控，请前往米游社App完成滑动验证。`
- 识别 `-100 / login` -> 提示：`⚠️ 米游社Cookie已过期，请发送 /绑定 扫码重新登录。`
- 避免直接将底层的技术栈名暴露给普通用户，同时杜绝误导性虚假诊断。
