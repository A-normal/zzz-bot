import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import {
  normalizeConfig,
  normalizeState,
  formatModelList,
  formatEndpointList,
  applyModelSwitch,
  applyEndpointSwitch,
  isMaster
} from "./aiChatCore.mjs"

const BASE_DIR = path.join(process.cwd(), "data", "aiChat")
export const CONFIG_PATH = path.join(BASE_DIR, "config.yaml")
export const STATE_PATH = path.join(BASE_DIR, "state.json")

function warn(msg) {
  try {
    if (typeof logger !== "undefined" && logger && typeof logger.warn === "function") logger.warn("[AIChat] " + msg)
  } catch {
    // 日志失败不影响主流程
  }
}

function error(msg) {
  try {
    if (typeof logger !== "undefined" && logger && typeof logger.error === "function") logger.error("[AIChat] " + msg)
  } catch {
    // 同上
  }
}

/** 每次调用都重新读盘，便于改完配置直接生效（不需要重启） */
export function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return normalizeConfig()
    const raw = YAML.parse(fs.readFileSync(CONFIG_PATH, "utf-8"))
    return normalizeConfig(raw || {})
  } catch (err) {
    warn("读取配置失败，使用默认配置：" + (err && err.message ? err.message : err))
    return normalizeConfig()
  }
}

export function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {}
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) || {}
  } catch (err) {
    warn("读取状态失败，回落默认接口：" + (err && err.message ? err.message : err))
    return {}
  }
}

export function saveState(state) {
  try {
    fs.mkdirSync(BASE_DIR, { recursive: true })
    const tmp = STATE_PATH + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8")
    fs.renameSync(tmp, STATE_PATH)
    return true
  } catch (err) {
    warn("写入状态失败（本次切换仅当前进程有效）：" + (err && err.message ? err.message : err))
    return false
  }
}

/**
 * 主人指令：/模型 [序号|名称]、/模型列表、/模型接口 [序号|名称]
 * 由 zzzShortcuts 解析后转交，避免落入"未识别快捷指令"拦截。
 */
export async function handleMasterCommand(e, kind, arg) {
  try {
    const cfg = loadConfig()
    if (!isMaster(e, cfg)) {
      await e.reply("仅主人可用。")
      return
    }

    const state = normalizeState(cfg, loadState())

    if (kind === "endpoints") {
      if (!arg) {
        await e.reply(formatEndpointList(cfg, state))
        return
      }
      const result = applyEndpointSwitch(cfg, state, arg)
      if (result.ok) saveState(result.state)
      await e.reply(result.message)
      return
    }

    if (!arg) {
      await e.reply(formatModelList(cfg, state))
      return
    }
    const result = applyModelSwitch(cfg, state, arg)
    if (result.ok) saveState(result.state)
    await e.reply(result.message)
  } catch (err) {
    error("主命令处理失败：" + (err && err.message ? err.message : err))
    try {
      await e.reply("AI 配置读取失败，请检查 data/aiChat/config.yaml")
    } catch {
      // ignore
    }
  }
}
