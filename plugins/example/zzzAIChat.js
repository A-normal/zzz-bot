import plugin from "../../lib/plugins/plugin.js"
import {
  decideRoute,
  resolveEndpoint,
  buildChatRequest,
  extractContent,
  trimReply,
  sniffMime
} from "./aiChatCore.mjs"
import { loadConfig, loadState } from "./aiChatControl.mjs"

const IMAGE_TIMEOUT_MS = 8000

function logMark(msg) {
  try {
    if (typeof logger !== "undefined" && logger && typeof logger.mark === "function") logger.mark(msg)
  } catch {
    // ignore
  }
}

function logWarn(msg) {
  try {
    if (typeof logger !== "undefined" && logger && typeof logger.warn === "function") logger.warn(msg)
  } catch {
    // ignore
  }
}

function logError(msg) {
  try {
    if (typeof logger !== "undefined" && logger && typeof logger.error === "function") logger.error(msg)
  } catch {
    // ignore
  }
}

function imageUrlOf(item) {
  if (typeof item === "string") return item
  if (item && typeof item === "object") return item.url || item.file || ""
  return ""
}

function describeHttpError(status, detail, canSwitch) {
  const switchTip = canSwitch ? "，或用 /模型 换一个模型" : ""
  let base
  if (status === 401) base = "接口鉴权失败（401）：密钥无效，或该地址还有一层前置鉴权（如 nginx Basic Auth）。"
  else if (status === 403) base = "接口拒绝访问（403），请检查密钥权限。"
  else if (status === 429) base = "接口限流（429），稍后再试" + switchTip + "。"
  else if (status === 503) base = "模型暂无可用额度（503），稍后再试" + switchTip + "。"
  else if (status === 404) base = "接口地址不存在（404），请检查 baseURL 是否包含 /v1。"
  else base = "模型调用失败：" + status
  return detail ? base + "｜" + detail : base
}

/** 尽量把网关/上游的错误说明透出来，避免只看到裸状态码 */
async function readErrorDetail(res) {
  try {
    const text = await res.text()
    if (!text) return ""
    try {
      const json = JSON.parse(text)
      const err = json && json.error
      const msg =
        (err && (err.readable_summary || err.message)) ||
        (json && typeof json.message === "string" ? json.message : "")
      return trimReply(String(msg || ""), 160)
    } catch {
      return trimReply(String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 160)
    }
  } catch {
    return ""
  }
}

/**
 * AI 兜底对话路由
 * - 只接管"群内 @机器人 且不带 / % # 命名空间"的普通消息（文本 / 图片）
 * - 排最后（priority 9998），前面所有指令插件都能优先处理
 * - 单轮、无上下文、只回一条（QQ 官方 Bot 被动回复配额限制）
 */
export class ZZZAIChat extends plugin {
  constructor() {
    super({
      name: "AI兜底对话",
      dsc: "群内 @机器人 的普通消息交给 OpenAI 兼容接口处理",
      event: "message",
      priority: 9998
    })
  }

  async accept(e) {
    try {
      const cfg = loadConfig()
      const decision = decideRoute(e, cfg)

      if (decision.action === "skip") return false

      if (decision.action === "hint_percent") {
        if (cfg.percentHint) await e.reply(cfg.percentHintText)
        return "return"
      }

      if (decision.action === "hint_empty") {
        await e.reply(cfg.emptyHintText)
        return "return"
      }

      const picked = resolveEndpoint(cfg, loadState())
      if (!picked) {
        await e.reply("还没有可用的模型接口，请先配置 data/aiChat/config.yaml")
        return "return"
      }

      const { endpoint, model } = picked
      const apiKey =
        (endpoint.apiKeyEnv ? process.env[endpoint.apiKeyEnv] || "" : "") || endpoint.apiKey || ""
      if (endpoint.apiKeyEnv && !apiKey) {
        await e.reply("接口 " + endpoint.name + " 未配置密钥（环境变量 " + endpoint.apiKeyEnv + " 为空）")
        return "return"
      }

      const images = await this.collectImages(e, cfg)
      const { url, headers, body } = buildChatRequest(cfg, endpoint, model, decision.text, images, apiKey)

      const started = Date.now()
      const res = await this.post(url, headers, body, endpoint.timeoutMs || cfg.timeoutMs)

      if (!res.ok) {
        const detail = await readErrorDetail(res)
        logWarn("[AIChat] HTTP " + res.status + " " + endpoint.name + "/" + model + " " + detail)
        await e.reply(describeHttpError(res.status, detail, (endpoint.models || []).length > 1))
        return "return"
      }

      const json = await res.json().catch(() => null)
      let content = trimReply(extractContent(json), cfg.maxReplyChars)
      if (!content) {
        const apiError = json && json.error && json.error.message
        content = apiError ? "模型调用失败：" + trimReply(String(apiError), 120) : "模型没有返回内容。"
      }

      const channel = e.isGroup ? "group:" + e.group_id : "private:" + e.user_id
      logMark("[AIChat] " + channel + " " + e.user_id + " " + model + " " + (Date.now() - started) + "ms " + images.length + "img")
      await e.reply(content)
      return "return"
    } catch (err) {
      const msg = err && err.name === "AbortError" ? "模型响应超时，请稍后再试。" : "AI 服务暂时不可用，请稍后再试。"
      logError("[AIChat] 处理失败：" + (err && err.message ? err.message : err))
      try {
        await e.reply(msg)
      } catch {
        // ignore
      }
      return "return"
    }
  }

  /** 下载图片并转 base64（不把 QQ/Telegram 的图片 URL 外传给模型服务） */
  async collectImages(e, cfg) {
    const list = Array.isArray(e.img) ? e.img.slice(0, cfg.maxImages) : []
    const out = []
    for (const item of list) {
      const url = imageUrlOf(item)
      if (!url) continue
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
        if (!res.ok) {
          logWarn("[AIChat] 图片下载失败 HTTP " + res.status)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length === 0 || buf.length > cfg.maxImageBytes) {
          logWarn("[AIChat] 图片体积不合规，已跳过：" + buf.length)
          continue
        }
        const mime = sniffMime(buf)
        if (!mime.startsWith("image/")) {
          logWarn("[AIChat] 非图片内容，已跳过：" + mime)
          continue
        }
        out.push({ mime, dataUrl: "data:" + mime + ";base64," + buf.toString("base64") })
      } catch (err) {
        logWarn("[AIChat] 图片下载异常：" + (err && err.message ? err.message : err))
      }
    }
    return out
  }

  /**
   * POST with retry.
   * 容器内经 Docker NAT 连外网时，TLS 握手偶发超过 undici 默认的 10s 连接超时
   * （ConnectTimeoutError），因此对「连接类失败」重试；真正的超时（AbortError）不重试。
   */
  async post(url, headers, body, timeoutMs, attempts = 3) {
    const payload = JSON.stringify(body)
    let lastError
    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await fetch(url, { method: "POST", headers, body: payload, signal: controller.signal })
      } catch (err) {
        lastError = err
        const aborted = err && err.name === "AbortError"
        if (aborted) throw err
        const reason = (err && err.cause && err.cause.message) || (err && err.message) || "unknown"
        logWarn("[AIChat] 请求失败（第 " + (i + 1) + "/" + attempts + " 次）：" + reason)
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  }
}
