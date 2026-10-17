// AI 兜底对话路由 · 纯逻辑验收测试
// 运行：node tests/ai-chat-core.test.mjs   （必须 0 fail；本文件是验收闸门，实现方不得修改）
// 注意：本沙箱内 "node --test" 会因 spawn EPERM 失败，必须直接运行本文件。

import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_CONFIG,
  normalizeConfig,
  decideRoute,
  isMaster,
  parseMasterCommand,
  normalizeState,
  resolveEndpoint,
  formatModelList,
  formatEndpointList,
  applyModelSwitch,
  applyEndpointSwitch,
  buildChatRequest,
  trimReply,
  extractContent,
  sniffMime,
} from "../plugins/example/aiChatCore.mjs"

/* ------------------------------------------------------------------ */
/* 测试夹具                                                            */
/* ------------------------------------------------------------------ */

const RAW_CFG = {
  endpoints: [
    {
      name: "local",
      baseURL: "http://127.0.0.1:1234/v1/",
      apiKeyEnv: "K1",
      supportsVision: true,
      models: ["m-vl", "m-72b"],
      defaultModel: "m-vl",
    },
    {
      name: "cloud",
      baseURL: "https://api.example.com/v1",
      apiKeyEnv: "K2",
      supportsVision: false,
      models: ["c-chat"],
      defaultModel: "c-chat",
    },
  ],
}

const cfg = () => normalizeConfig(RAW_CFG)

function mkE(extra = {}) {
  return {
    isGroup: true,
    atBot: true,
    msg: "你好",
    user_id: "10001",
    group_id: "20002",
    img: [],
    ...extra,
  }
}

const images2 = [
  { mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
  { mime: "image/jpeg", dataUrl: "data:image/jpeg;base64,BBB" },
]

/* ------------------------------------------------------------------ */
/* 1. 配置规范化                                                       */
/* ------------------------------------------------------------------ */

test("DEFAULT_CONFIG 基线", () => {
  assert.deepEqual(DEFAULT_CONFIG.endpoints, [])
  assert.ok(Array.isArray(DEFAULT_CONFIG.shortcutWords))
  assert.equal(DEFAULT_CONFIG.enabled, true)
  assert.equal(DEFAULT_CONFIG.allowPrivate, false)
})

test("normalizeConfig(undefined) 不抛异常且回落默认", () => {
  const c = normalizeConfig(undefined)
  assert.equal(c.enabled, true)
  assert.ok(c.shortcutWords instanceof Set)
  assert.deepEqual(c.endpoints, [])
  assert.deepEqual(c.groupWhitelist, [])
})

test("normalizeConfig 转换 shortcutWords 为 Set", () => {
  const c = cfg()
  assert.ok(c.shortcutWords.has("帮助"))
  assert.ok(c.shortcutWords.has("面板"))
  assert.equal(c.shortcutWords.has("不存在的词"), false)
})

test("normalizeConfig 丢弃缺 name/baseURL 的接口，并补默认值", () => {
  const c = normalizeConfig({
    endpoints: [
      { name: "ok", baseURL: "http://x/v1" },
      { baseURL: "http://no-name/v1" },
      { name: "no-url" },
    ],
  })
  assert.equal(c.endpoints.length, 1)
  assert.equal(c.endpoints[0].name, "ok")
  assert.equal(c.endpoints[0].supportsVision, false)
  assert.equal(typeof c.endpoints[0].timeoutMs, "number")
  assert.equal(c.endpoints[0].defaultModel, "")
})

test("normalizeConfig 保留内联 apiKey，缺省为空串", () => {
  const c = normalizeConfig({
    endpoints: [
      { name: "a", baseURL: "http://a/v1", apiKey: "sk-x" },
      { name: "b", baseURL: "http://b/v1" },
    ],
  })
  assert.equal(c.endpoints[0].apiKey, "sk-x")
  assert.equal(c.endpoints[1].apiKey, "")
})

test("normalizeConfig 的 defaultModel 回落到 models[0]", () => {
  const c = normalizeConfig({ endpoints: [{ name: "a", baseURL: "http://a/v1", models: ["m1", "m2"] }] })
  assert.equal(c.endpoints[0].defaultModel, "m1")
})

test("normalizeConfig 的 whitelist / masterUserIds 转字符串数组", () => {
  const c = normalizeConfig({ groupWhitelist: [123, "456", ""], masterUserIds: [789] })
  assert.deepEqual(c.groupWhitelist, ["123", "456"])
  assert.deepEqual(c.masterUserIds, ["789"])
})

/* ------------------------------------------------------------------ */
/* 2. decideRoute                                                      */
/* ------------------------------------------------------------------ */

test("decideRoute: enabled=false 直接跳过", () => {
  const c = { ...cfg(), enabled: false }
  assert.deepEqual(decideRoute(mkE(), c), { action: "skip", reason: "disabled", text: "你好" })
})

test("decideRoute: % 未识别 → 提示（且不需要 @）", () => {
  const c = cfg()
  const d = decideRoute(mkE({ msg: "%未知指令" }), c)
  assert.equal(d.action, "hint_percent")
  assert.equal(d.reason, "percent")
  const d2 = decideRoute({ isGroup: true, atBot: false, msg: "％全角", img: [] }, c)
  assert.equal(d2.action, "hint_percent")
})

test("decideRoute: / 与 # 命名空间一律跳过", () => {
  const c = cfg()
  for (const msg of ["/面板", "/未知", "#面板", "＃帮助"]) {
    const d = decideRoute(mkE({ msg }), c)
    assert.equal(d.action, "skip", msg)
    assert.equal(d.reason, "namespace", msg)
  }
})

test("decideRoute: 已有插件回复过则让位（避免二次回复）", () => {
  const c = cfg()
  const d = decideRoute(mkE({ _replied: true }), c)
  assert.equal(d.action, "skip")
  assert.equal(d.reason, "already-replied")
  const d2 = decideRoute(mkE({ msg: "%卡片", atBot: false, _replied: true }), c)
  assert.equal(d2.action, "skip")
  assert.equal(d2.reason, "already-replied")
})

test("decideRoute: Telegram 文本 @username 等价于 @机器人", () => {
  const c = cfg()
  const tg = (msg) =>
    mkE({ msg, atBot: false, bot: { info: { username: "Bjnobot" } } })
  const d = decideRoute(tg("@Bjnobot 你好"), c)
  assert.equal(d.action, "ai")
  assert.equal(d.text, "你好")
  assert.equal(decideRoute(tg("@bjnobot"), c).action, "hint_empty")
  assert.equal(decideRoute(tg("你好"), c).reason, "no-at")
})

test("decideRoute: 群聊未 @ → 跳过", () => {
  const c = cfg()
  const d = decideRoute(mkE({ atBot: false }), c)
  assert.equal(d.action, "skip")
  assert.equal(d.reason, "no-at")
})

test("decideRoute: 私聊默认不接，可配置打开", () => {
  const c = cfg()
  assert.equal(decideRoute(mkE({ isGroup: false, atBot: false }), c).reason, "private")
  const c2 = { ...c, allowPrivate: true }
  assert.equal(decideRoute(mkE({ isGroup: false, atBot: false }), c2).action, "ai")
})

test("decideRoute: 群白名单", () => {
  const c = { ...cfg(), groupWhitelist: ["999"] }
  assert.equal(decideRoute(mkE(), c).reason, "group")
  const c2 = { ...c, groupWhitelist: ["20002"] }
  assert.equal(decideRoute(mkE(), c2).action, "ai")
  const c3 = { ...c, groupWhitelist: [] }
  assert.equal(decideRoute(mkE(), c3).action, "ai")
})

test("decideRoute: 空文本无图 → hint_empty；只有图 → ai", () => {
  const c = cfg()
  assert.equal(decideRoute(mkE({ msg: "   " }), c).action, "hint_empty")
  assert.equal(decideRoute(mkE({ msg: "", img: ["http://img/1.png"] }), c).action, "ai")
})

test("decideRoute: 裸词指令精确匹配被拦，带后缀的正常放行", () => {
  const c = cfg()
  assert.equal(decideRoute(mkE({ msg: "面板" }), c).reason, "shortcut-word")
  assert.equal(decideRoute(mkE({ msg: "签到" }), c).reason, "shortcut-word")
  assert.equal(decideRoute(mkE({ msg: "面板怎么用" }), c).action, "ai")
  assert.equal(decideRoute(mkE({ msg: "签到是什么意思" }), c).action, "ai")
})

test("decideRoute: 清洗 <@...> 与 CQ 码，并返回 text", () => {
  const c = cfg()
  const d1 = decideRoute(mkE({ msg: "<@!123456>你好呀" }), c)
  assert.equal(d1.text, "你好呀")
  assert.equal(d1.action, "ai")

  const d2 = decideRoute(mkE({ msg: "", raw_message: "[CQ:image,file=x.jpg]看看这个" }), c)
  assert.equal(d2.text, "看看这个")
  assert.equal(d2.action, "ai")

  const d3 = decideRoute(mkE({ msg: "", raw_message: "[CQ:image,file=x.jpg]" }), c)
  assert.equal(d3.action, "hint_empty")
})

/* ------------------------------------------------------------------ */
/* 3. 主人判定与主命令解析                                             */
/* ------------------------------------------------------------------ */

test("isMaster: e.isMaster 或 masterUserIds", () => {
  const c = cfg()
  assert.equal(isMaster({ isMaster: true, user_id: "1" }, c), true)
  assert.equal(isMaster({ isMaster: false, user_id: "777" }, { ...c, masterUserIds: ["777"] }), true)
  assert.equal(isMaster({ isMaster: false, user_id: "778" }, { ...c, masterUserIds: ["777"] }), false)
})

test("parseMasterCommand: 各种形态", () => {
  assert.deepEqual(parseMasterCommand("/模型"), { kind: "models", arg: "" })
  assert.deepEqual(parseMasterCommand("/模型 2"), { kind: "models", arg: "2" })
  assert.deepEqual(parseMasterCommand("/模型列表"), { kind: "models", arg: "" })
  assert.deepEqual(parseMasterCommand("#模型 m-72b"), { kind: "models", arg: "m-72b" })
  assert.deepEqual(parseMasterCommand("/模型接口"), { kind: "endpoints", arg: "" })
  assert.deepEqual(parseMasterCommand("/模型接口 cloud"), { kind: "endpoints", arg: "cloud" })
  assert.deepEqual(parseMasterCommand("  /模型  "), { kind: "models", arg: "" })
})

test("parseMasterCommand: 裸词与近似词不匹配", () => {
  assert.equal(parseMasterCommand("模型"), null)
  assert.equal(parseMasterCommand("模型怎么选"), null)
  assert.equal(parseMasterCommand("/模型化"), null)
  assert.equal(parseMasterCommand(""), null)
  assert.equal(parseMasterCommand(undefined), null)
})

/* ------------------------------------------------------------------ */
/* 4. 状态与接口选择                                                   */
/* ------------------------------------------------------------------ */

test("normalizeState: 空状态回落第一个接口与默认模型", () => {
  const c = cfg()
  assert.deepEqual(normalizeState(c, {}), { endpoint: "local", model: "m-vl" })
  assert.deepEqual(normalizeState(c, undefined), { endpoint: "local", model: "m-vl" })
})

test("normalizeState: 非法接口名与非法模型均回落", () => {
  const c = cfg()
  assert.deepEqual(normalizeState(c, { endpoint: "不存在", model: "x" }), { endpoint: "local", model: "m-vl" })
  assert.deepEqual(normalizeState(c, { endpoint: "cloud", model: "m-vl" }), { endpoint: "cloud", model: "c-chat" })
})

test("normalizeState: 合法状态原样保留", () => {
  const c = cfg()
  assert.deepEqual(normalizeState(c, { endpoint: "local", model: "m-72b" }), { endpoint: "local", model: "m-72b" })
})

test("resolveEndpoint: 无配置返回 null，正常返回接口对象", () => {
  assert.equal(resolveEndpoint({ endpoints: [] }, {}), null)
  const c = cfg()
  const r = resolveEndpoint(c, { endpoint: "cloud", model: "c-chat" })
  assert.ok(r)
  assert.equal(r.endpoint.name, "cloud")
  assert.equal(r.endpoint.baseURL, "https://api.example.com/v1")
  assert.equal(r.model, "c-chat")
  assert.deepEqual(r.state, { endpoint: "cloud", model: "c-chat" })
})

/* ------------------------------------------------------------------ */
/* 5. 列表渲染                                                         */
/* ------------------------------------------------------------------ */

test("formatModelList: 列出全部模型并标记当前项", () => {
  const c = cfg()
  const s = formatModelList(c, { endpoint: "local", model: "m-72b" })
  assert.match(s, /当前接口：local/)
  assert.match(s, /✓/)
  assert.match(s, /1\./)
  assert.match(s, /2\./)
  assert.ok(s.includes("m-vl"))
  assert.ok(s.includes("m-72b"))
  assert.ok(s.includes("发送 /模型"))
  const currentLine = s.split("\n").find((l) => l.includes("m-72b"))
  assert.ok(currentLine.includes("✓"))
})

test("formatModelList: 无接口时的提示", () => {
  const s = formatModelList({ endpoints: [] }, {})
  assert.equal(typeof s, "string")
  assert.ok(s.length > 0)
})

test("formatEndpointList: 列出接口与地址并标记当前项", () => {
  const c = cfg()
  const s = formatEndpointList(c, { endpoint: "local", model: "m-vl" })
  assert.ok(s.includes("local"))
  assert.ok(s.includes("cloud"))
  assert.ok(s.includes("http://127.0.0.1:1234/v1"))
  assert.ok(s.includes("✓"))
  assert.ok(s.includes("发送 /模型接口"))
})

/* ------------------------------------------------------------------ */
/* 6. 切换                                                             */
/* ------------------------------------------------------------------ */

test("applyModelSwitch: 按序号与按名称", () => {
  const c = cfg()
  const st = { endpoint: "local", model: "m-vl" }
  const r1 = applyModelSwitch(c, st, "2")
  assert.equal(r1.ok, true)
  assert.equal(r1.state.model, "m-72b")
  assert.equal(r1.state.endpoint, "local")
  assert.ok(r1.message.includes("m-72b"))

  const r2 = applyModelSwitch(c, st, "m-72b")
  assert.equal(r2.ok, true)
  assert.equal(r2.state.model, "m-72b")
})

test("applyModelSwitch: 越界与不存在的模型失败", () => {
  const c = cfg()
  const st = { endpoint: "local", model: "m-vl" }
  const r1 = applyModelSwitch(c, st, "9")
  assert.equal(r1.ok, false)
  assert.deepEqual(r1.state, st)
  assert.ok(typeof r1.message === "string" && r1.message.length > 0)

  const r2 = applyModelSwitch(c, st, "不存在的模型")
  assert.equal(r2.ok, false)
  assert.deepEqual(r2.state, st)
})

test("applyEndpointSwitch: 按序号切换并重置模型", () => {
  const c = cfg()
  const st = { endpoint: "local", model: "m-72b" }
  const r = applyEndpointSwitch(c, st, "2")
  assert.equal(r.ok, true)
  assert.equal(r.state.endpoint, "cloud")
  assert.equal(r.state.model, "c-chat")
  assert.ok(r.message.includes("cloud"))
})

test("applyEndpointSwitch: 按名称切换 / 非法失败", () => {
  const c = cfg()
  const st = { endpoint: "cloud", model: "c-chat" }
  const r1 = applyEndpointSwitch(c, st, "local")
  assert.equal(r1.ok, true)
  assert.equal(r1.state.endpoint, "local")
  assert.equal(r1.state.model, "m-vl")

  const r2 = applyEndpointSwitch(c, st, "不存在")
  assert.equal(r2.ok, false)
  assert.deepEqual(r2.state, st)
})

/* ------------------------------------------------------------------ */
/* 7. 请求构造                                                         */
/* ------------------------------------------------------------------ */

test("buildChatRequest: URL 拼接、鉴权头与单轮消息", () => {
  const c = cfg()
  const ep = c.endpoints[0]
  const { url, headers, body } = buildChatRequest(c, ep, "m-vl", "你好", [], "sk-test")
  assert.equal(url, "http://127.0.0.1:1234/v1/chat/completions")
  assert.equal(headers.Authorization, "Bearer sk-test")
  assert.equal(headers["Content-Type"], "application/json")
  assert.equal(body.model, "m-vl")
  assert.equal(body.stream, false)
  assert.equal(typeof body.temperature, "number")
  assert.equal(typeof body.max_tokens, "number")
  assert.equal(body.messages.length, 2)
  assert.equal(body.messages[0].role, "system")
  assert.equal(body.messages[1].role, "user")
  assert.equal(body.messages[1].content, "你好")
})

test("buildChatRequest: authHeader 原样透传（兼容 Basic 等前置鉴权）", () => {
  const c = cfg()
  const ep = { ...c.endpoints[0], authHeader: "Basic dXNlcjpwYXNz" }
  const { headers } = buildChatRequest(c, ep, "m-vl", "hi", [], "ignored")
  assert.equal(headers.Authorization, "Basic dXNlcjpwYXNz")
})

test("buildChatRequest: 空 apiKey 不带 Authorization", () => {
  const c = cfg()
  const { headers } = buildChatRequest(c, c.endpoints[0], "m-vl", "hi", [], "")
  assert.equal(headers.Authorization, undefined)
})

test("buildChatRequest: 支持视觉时图片按顺序拼在文本后", () => {
  const c = cfg()
  const { body } = buildChatRequest(c, c.endpoints[0], "m-vl", "看图", images2, "k")
  const parts = body.messages[1].content
  assert.ok(Array.isArray(parts))
  assert.equal(parts.length, 3)
  assert.equal(parts[0].type, "text")
  assert.equal(parts[0].text, "看图")
  assert.equal(parts[1].type, "image_url")
  assert.equal(parts[1].image_url.url, images2[0].dataUrl)
  assert.equal(parts[2].image_url.url, images2[1].dataUrl)
})

test("buildChatRequest: 不支持视觉时忽略图片并追加说明", () => {
  const c = cfg()
  const ep = c.endpoints[1]
  assert.equal(ep.supportsVision, false)
  const { body } = buildChatRequest(c, ep, "c-chat", "看图", images2, "k")
  const content = body.messages[1].content
  assert.equal(typeof content, "string")
  assert.ok(content.startsWith("看图"))
  assert.ok(content.includes("2"))
  assert.ok(content.includes("不支持看图"))
})

test("buildChatRequest: 图片数量上限", () => {
  const c = { ...cfg(), maxImages: 1 }
  const { body } = buildChatRequest(c, c.endpoints[0], "m-vl", "看图", images2, "k")
  const parts = body.messages[1].content
  assert.equal(parts.length, 2)
})

test("buildChatRequest: 超长输入被截断", () => {
  const c = { ...cfg(), maxInputChars: 100 }
  const { body } = buildChatRequest(c, c.endpoints[0], "m-vl", "字".repeat(500), [], "k")
  const content = body.messages[1].content
  assert.ok(content.length <= 101)
  assert.ok(content.endsWith("…"))
})

/* ------------------------------------------------------------------ */
/* 8. 回复与响应处理                                                   */
/* ------------------------------------------------------------------ */

test("trimReply: 短文本原样，长文本截断并加后缀", () => {
  assert.equal(trimReply("短", 10), "短")
  assert.equal(trimReply("  x  ", 10), "x")
  const long = trimReply("字".repeat(100), 20)
  assert.ok(long.length <= 28)
  assert.ok(long.startsWith("字".repeat(20)))
  assert.ok(long.includes("截断"))
  assert.equal(trimReply(undefined, 10), "")
})

test("extractContent: 字符串、数组分段与异常", () => {
  assert.equal(extractContent({ choices: [{ message: { content: "hi" } }] }), "hi")
  assert.equal(
    extractContent({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] }),
    "ab",
  )
  assert.equal(extractContent({}), "")
  assert.equal(extractContent(null), "")
  assert.equal(extractContent({ choices: [] }), "")
})

test("sniffMime: 常见图片魔数", () => {
  assert.equal(sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png")
  assert.equal(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg")
  assert.equal(sniffMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "image/gif")
  assert.equal(sniffMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp")
  assert.equal(sniffMime(Uint8Array.from([0x42, 0x4d, 0x00, 0x00])), "image/bmp")
  assert.equal(sniffMime(Uint8Array.from([0x00, 0x01, 0x02, 0x03])), "application/octet-stream")
})

test("normalizeConfig 保留 enableSearch，缺省为 false", () => {
  const c = normalizeConfig({
    endpoints: [
      { name: "a", baseURL: "http://a/v1", enableSearch: true },
      { name: "b", baseURL: "http://b/v1" },
    ],
  })
  assert.equal(c.endpoints[0].enableSearch, true)
  assert.equal(c.endpoints[1].enableSearch, false)
})

test("buildChatRequest: enableSearch 为 true 时追加 tools: [{ googleSearch: {} }]", () => {
  const c = cfg()
  const ep = { ...c.endpoints[0], enableSearch: true }
  const { body } = buildChatRequest(c, ep, "m1", "hi", [], "key")
  assert.deepEqual(body.tools, [{ googleSearch: {} }])
})

test("buildChatRequest: enableSearch 缺省或为 false 时不包含 tools", () => {
  const c = cfg()
  const ep = { ...c.endpoints[0], enableSearch: false }
  const { body } = buildChatRequest(c, ep, "m1", "hi", [], "key")
  assert.equal(body.tools, undefined)
})
