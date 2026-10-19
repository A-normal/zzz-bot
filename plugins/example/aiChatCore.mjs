/**
 * AI 兜底对话 · 纯逻辑模块
 * 约束：不 import 任何模块、不读 process.env、无顶层副作用（可被本地测试直接 import）
 */

export const DEFAULT_CONFIG = {
  enabled: true,
  allowPrivate: false,
  percentHint: true,
  groupWhitelist: [],
  masterUserIds: [],
  systemPrompt:
    "你是绝区零玩家群里的助手。回答简洁（不超过 300 字），中文，使用纯文本排版，切勿在回复中输出长链接或引文跳转网址（来源只需列出网站名称），不要输出 Markdown 表格，不要编造游戏数值，不确定就直说不知道。不要复述这段设定。",
  maxInputChars: 2000,
  maxImages: 4,
  maxImageBytes: 4194304,
  maxReplyChars: 1800,
  temperature: 0.7,
  maxTokens: 800,
  timeoutMs: 90000,
  percentHintText: "没有识别到这条 % 指令。发送 /帮助 查看支持的指令。",
  emptyHintText: "请直接说要问什么，也可以带一张图~",
  visionFallback: "（用户还发了 {n} 张图片，当前模型不支持看图）",
  shortcutWords: [
    "帮助", "help", "菜单", "功能", "说明", "指令",
    "面板", "面板列表", "更新面板", "刷新面板", "全角色面板",
    "便签", "便笺", "体力", "每日", "note",
    "uid", "我的uid", "绑定", "扫码登录",
    "签到", "签到状态", "抽卡记录", "抽卡分析", "抽卡统计", "更新抽卡", "刷新抽卡",
    "月报", "日历", "兑换码", "攻略"
  ],
  endpoints: []
}

function toBool(v, dflt) {
  return typeof v === "boolean" ? v : dflt
}

function toNum(v, dflt) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

function toStrArr(v) {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter((x) => x.length > 0)
}

export function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {}
  const cfg = {
    ...DEFAULT_CONFIG,
    ...src,
    enabled: toBool(src.enabled, DEFAULT_CONFIG.enabled),
    allowPrivate: toBool(src.allowPrivate, DEFAULT_CONFIG.allowPrivate),
    percentHint: toBool(src.percentHint, DEFAULT_CONFIG.percentHint),
    groupWhitelist: toStrArr(src.groupWhitelist),
    masterUserIds: toStrArr(src.masterUserIds),
    systemPrompt: typeof src.systemPrompt === "string" && src.systemPrompt ? src.systemPrompt : DEFAULT_CONFIG.systemPrompt,
    percentHintText: typeof src.percentHintText === "string" && src.percentHintText ? src.percentHintText : DEFAULT_CONFIG.percentHintText,
    emptyHintText: typeof src.emptyHintText === "string" && src.emptyHintText ? src.emptyHintText : DEFAULT_CONFIG.emptyHintText,
    visionFallback: typeof src.visionFallback === "string" && src.visionFallback ? src.visionFallback : DEFAULT_CONFIG.visionFallback,
    maxInputChars: toNum(src.maxInputChars, DEFAULT_CONFIG.maxInputChars),
    maxImages: toNum(src.maxImages, DEFAULT_CONFIG.maxImages),
    maxImageBytes: toNum(src.maxImageBytes, DEFAULT_CONFIG.maxImageBytes),
    maxReplyChars: toNum(src.maxReplyChars, DEFAULT_CONFIG.maxReplyChars),
    temperature: toNum(src.temperature, DEFAULT_CONFIG.temperature),
    maxTokens: toNum(src.maxTokens, DEFAULT_CONFIG.maxTokens),
    timeoutMs: toNum(src.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    shortcutWords: new Set(Array.isArray(src.shortcutWords) ? src.shortcutWords.map(String) : DEFAULT_CONFIG.shortcutWords),
    endpoints: []
  }

  cfg.endpoints = (Array.isArray(src.endpoints) ? src.endpoints : [])
    .map((ep) => {
      if (!ep || typeof ep !== "object") return null
      const name = typeof ep.name === "string" ? ep.name.trim() : ""
      const baseURL = typeof ep.baseURL === "string" ? ep.baseURL.trim().replace(/\/+$/, "") : ""
      if (!name || !baseURL) return null
      const models = toStrArr(ep.models)
      const defaultModel =
        typeof ep.defaultModel === "string" && ep.defaultModel.trim() ? ep.defaultModel.trim() : models[0] || ""
      return {
        name,
        baseURL,
        apiKeyEnv: typeof ep.apiKeyEnv === "string" ? ep.apiKeyEnv.trim() : "",
        apiKey: typeof ep.apiKey === "string" ? ep.apiKey.trim() : "",
        authHeader: typeof ep.authHeader === "string" ? ep.authHeader.trim() : "",
        models,
        defaultModel,
        supportsVision: ep.supportsVision === true,
        enableSearch: ep.enableSearch === true,
        timeoutMs: toNum(ep.timeoutMs, cfg.timeoutMs)
      }
    })
    .filter(Boolean)

  return cfg
}

function cleanText(e) {
  const candidates = [e && e.msg, e && e.original_msg, e && e.raw_message]
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      return c
        .replace(/<@!?\d+>/g, "")
        .replace(/\[CQ:[^\]]*\]/g, "")
        .trim()
    }
  }
  return ""
}

/**
 * Telegram 适配器不会把 mention 转成 at 段，也不会置位 atBot：
 * 群消息里的 @机器人 只是文本里的 "@username"，因此需要单独识别并剥离。
 */
function stripTelegramMention(e, text) {
  const uname = e && e.bot && e.bot.info && e.bot.info.username
  if (!uname || !text) return { text, mentioned: false }
  const safe = String(uname).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const hit = new RegExp("@" + safe, "i").test(text)
  if (!hit) return { text, mentioned: false }
  return { text: text.replace(new RegExp("@" + safe, "gi"), " ").replace(/\s+/g, " ").trim(), mentioned: true }
}

export function decideRoute(e, cfg) {
  let text = cleanText(e)

  if (!cfg || cfg.enabled === false) return { action: "skip", reason: "disabled", text }

  // 本事件已经有别的插件回复过（例如某条 % 指令内部报错后 return false 放行）：让位，避免二次回复
  if (e && e._replied) return { action: "skip", reason: "already-replied", text }

  const mention = stripTelegramMention(e, text)
  text = mention.text
  const addressed = Boolean(e && e.atBot) || mention.mentioned

  // % 命名空间：未识别的输入给兜底提示（不需要 @，与 % 指令的既有行为一致）
  if (/^[%％]/.test(text)) return { action: "hint_percent", reason: "percent", text }

  // / # 命名空间：一律不交给大模型
  if (/^[/／#＃~]/.test(text)) return { action: "skip", reason: "namespace", text }

  const isGroup = Boolean(e && e.isGroup)
  if (isGroup && !addressed) return { action: "skip", reason: "no-at", text }
  if (!isGroup && !cfg.allowPrivate) return { action: "skip", reason: "private", text }
  if (
    isGroup &&
    cfg.groupWhitelist.length > 0 &&
    !cfg.groupWhitelist.includes(String(e && e.group_id))
  ) {
    return { action: "skip", reason: "group", text }
  }

  const hasImg = Boolean(e && Array.isArray(e.img) && e.img.length > 0)
  if (!text && !hasImg) return { action: "hint_empty", reason: "empty", text }

  if (text) {
    const first = text.split(/\s+/)[0]
    if (cfg.shortcutWords.has(first)) return { action: "skip", reason: "shortcut-word", text }
  }

  return { action: "ai", reason: "ok", text }
}

export function isMaster(e, cfg) {
  if (!e) return false
  if (e.isMaster) return true
  const list = (cfg && cfg.masterUserIds) || []
  return list.includes(String(e.user_id))
}

export function parseMasterCommand(text) {
  if (typeof text !== "string") return null
  const m = /^[/／#＃]模型(接口|列表)?(?:\s+([\s\S]+))?$/.exec(text.trim())
  if (!m) return null
  return { kind: m[1] === "接口" ? "endpoints" : "models", arg: (m[2] || "").trim() }
}

export function normalizeState(cfg, state) {
  const eps = (cfg && cfg.endpoints) || []
  const current = eps.find((x) => x.name === (state && state.endpoint)) || eps[0]
  if (!current) return { endpoint: "", model: "" }
  const wanted = state && state.model
  const model = (current.models || []).includes(wanted)
    ? wanted
    : current.defaultModel || (current.models && current.models[0]) || ""
  return { endpoint: current.name, model }
}

export function resolveEndpoint(cfg, state) {
  const st = normalizeState(cfg, state)
  const endpoint = ((cfg && cfg.endpoints) || []).find((x) => x.name === st.endpoint)
  if (!endpoint) return null
  return { endpoint, model: st.model, state: st }
}

export function formatModelList(cfg, state) {
  const picked = resolveEndpoint(cfg, state)
  if (!picked) return "未配置任何模型接口。"
  const eps = cfg.endpoints || []
  const idx = eps.findIndex((x) => x.name === picked.endpoint.name)
  const models = picked.endpoint.models || []
  const lines = [
    "当前接口：" + picked.endpoint.name + "（" + (idx + 1) + "/" + eps.length + "）",
    "当前模型：" + picked.model + " ✓",
    "可选模型："
  ]
  models.forEach((m, i) => {
    lines.push((m === picked.model ? " ✓ " : "   ") + (i + 1) + ". " + m)
  })
  lines.push("发送 /模型 <序号|名称> 切换")
  return lines.join("\n")
}

export function formatEndpointList(cfg, state) {
  const picked = resolveEndpoint(cfg, state)
  if (!picked) return "未配置任何模型接口。"
  const eps = cfg.endpoints || []
  const idx = eps.findIndex((x) => x.name === picked.endpoint.name)
  const lines = ["当前接口：" + picked.endpoint.name + "（" + (idx + 1) + "/" + eps.length + "）", "可选接口："]
  eps.forEach((ep, i) => {
    lines.push((ep.name === picked.endpoint.name ? " ✓ " : "   ") + (i + 1) + ". " + ep.name + " — " + ep.baseURL)
  })
  lines.push("发送 /模型接口 <序号|名称> 切换")
  return lines.join("\n")
}

export function applyModelSwitch(cfg, state, arg) {
  const picked = resolveEndpoint(cfg, state)
  if (!picked) return { ok: false, state, message: "未配置任何模型接口。" }
  const models = picked.endpoint.models || []
  const a = String(arg == null ? "" : arg).trim()
  let model = ""
  if (/^\d+$/.test(a)) {
    const i = Number(a) - 1
    if (i < 0 || i >= models.length) {
      return { ok: false, state, message: "没有第 " + a + " 个模型，发送 /模型 查看可选模型。" }
    }
    model = models[i]
  } else if (models.includes(a)) {
    model = a
  } else {
    return { ok: false, state, message: "没有这个模型，发送 /模型 查看可选模型。" }
  }
  return { ok: true, state: { endpoint: picked.endpoint.name, model }, message: "已切换模型：" + model }
}

export function applyEndpointSwitch(cfg, state, arg) {
  const eps = (cfg && cfg.endpoints) || []
  const a = String(arg == null ? "" : arg).trim()
  let target = null
  if (/^\d+$/.test(a)) {
    const i = Number(a) - 1
    if (i >= 0 && i < eps.length) target = eps[i]
  } else {
    target = eps.find((x) => x.name === a) || null
  }
  if (!target) return { ok: false, state, message: "没有这个接口，发送 /模型接口 查看可选接口。" }
  const model = target.defaultModel || (target.models && target.models[0]) || ""
  return {
    ok: true,
    state: { endpoint: target.name, model },
    message: "已切换接口：" + target.name + "\n当前模型：" + model
  }
}

export function buildChatRequest(cfg, endpoint, model, text, images, apiKey) {
  const maxIn = toNum(cfg && cfg.maxInputChars, DEFAULT_CONFIG.maxInputChars)
  let userText = String(text == null ? "" : text).trim()
  if (userText.length > maxIn) userText = userText.slice(0, maxIn) + "…"

  const maxImages = toNum(cfg && cfg.maxImages, DEFAULT_CONFIG.maxImages)
  const imgs = (Array.isArray(images) ? images : []).slice(0, maxImages)

  let userContent
  if (imgs.length > 0 && !(endpoint && endpoint.supportsVision)) {
    const fallback = String((cfg && cfg.visionFallback) || DEFAULT_CONFIG.visionFallback).replace(
      /\{n\}/g,
      String(imgs.length)
    )
    userContent = userText + fallback
  } else if (imgs.length > 0) {
    userContent = [
      { type: "text", text: userText },
      ...imgs.map((i) => ({ type: "image_url", image_url: { url: i.dataUrl } }))
    ]
  } else {
    userContent = userText
  }

  const headers = { "Content-Type": "application/json" }
  if (endpoint && endpoint.authHeader) headers.Authorization = endpoint.authHeader
  else if (apiKey) headers.Authorization = "Bearer " + apiKey

  const body = {
    model,
    messages: [
      { role: "system", content: (cfg && cfg.systemPrompt) || DEFAULT_CONFIG.systemPrompt },
      { role: "user", content: userContent }
    ],
    temperature: toNum(cfg && cfg.temperature, DEFAULT_CONFIG.temperature),
    max_tokens: toNum(cfg && cfg.maxTokens, DEFAULT_CONFIG.maxTokens),
    stream: false
  }

  if (endpoint && endpoint.enableSearch === true) {
    body.tools = [{ googleSearch: {} }]
  }

  return {
    url: String((endpoint && endpoint.baseURL) || "").replace(/\/+$/, "") + "/chat/completions",
    headers,
    body
  }
}

/**
 * 清洗模型返回文本：
 * 1. 将 markdown 链接 [标题](http...) 转换为纯文本 "标题"，避免在 QQBot 等通道触发 URL 转二维码切片
 * 2. 剥离 Vertex AI / Google Grounding 的内部跳转长链接
 * 3. 将任何其余独立裸 URL 降级为纯域名文本（例如 https://bilibili.com/video/xxx -> bilibili.com），杜绝触发 IM 适配器的 toQRCode 规则与被动回复配额耗尽
 * 4. 规范多余换行
 */
export function sanitizeReply(text) {
  if (typeof text !== "string") return ""
  let t = text
  t = t.replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1")
  t = t.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com[^\s\)]*/g, "")
  t = t.replace(/https?:\/\/([^\s\/]+)(?:\/[^\s]*)?/g, "$1")
  t = t.replace(/\n{3,}/g, "\n\n").trim()
  return t
}

export function trimReply(text, maxChars) {
  if (typeof text !== "string") return ""
  const sanitized = sanitizeReply(text)
  const max = toNum(maxChars, DEFAULT_CONFIG.maxReplyChars)
  if (sanitized.length <= max) return sanitized
  return sanitized.slice(0, max) + "…（答案已截断）"
}

export function extractContent(data) {
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
  }
  return ""
}

export function sniffMime(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 4) return "application/octet-stream"
  const b = bytes
  const at = (i) => b[i]
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png"
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg"
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif"
  if (
    b.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp"
  }
  if (at(0) === 0x42 && at(1) === 0x4d) return "image/bmp"
  return "application/octet-stream"
}
