import plugin from "../../lib/plugins/plugin.js"
import NoteUser from "../genshin/model/mys/NoteUser.js"
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"

const ACT_ID = "e202406242138391"
const API_BASE = "https://api-takumi.mihoyo.com/event/luna/zzz"
const CONFIG_PATH = path.join(process.cwd(), "data", "zzzSign", "config.yaml")
const REDIS_AUTO_USERS_KEY = "ZZZ:SIGN:AUTO_USERS"

// 默认行为策略配置
const DEFAULT_CFG = {
  windowStart: 7, // 7:00
  windowEnd: 22,  // 22:00
  notifySuccess: true, // 开启成功通知，以便在群内@说明结果
  notifyFailure: true,
  debug: false,
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, "utf-8")
      return { ...DEFAULT_CFG, ...YAML.parse(content) }
    }
  } catch (e) {
    logger.warn(`[绝区零签到] 读取配置文件失败，使用默认配置: ${e.message}`)
  }
  return { ...DEFAULT_CFG }
}

export class zzzSign extends plugin {
  constructor() {
    super({
      name: "绝区零米游社签到",
      dsc: "绝区零米游社社区签到（单次签到、状态查询、指令开启/关闭自动签到）",
      event: "message",
      priority: -100,
      rule: [
        {
          reg: "^(#|%|/)?(zzz|ZZZ|绝区零)?(社区)?签到$",
          fnc: "manualSign",
        },
        {
          reg: "^(#|%|/)?(zzz|ZZZ|绝区零)?签到状态$",
          fnc: "signStatus",
        },
        {
          reg: "^(#|%|/)?(zzz|ZZZ|绝区零)?(开启|启用)自动签到$",
          fnc: "enableAutoSign",
        },
        {
          reg: "^(#|%|/)?(zzz|ZZZ|绝区零)?(关闭|禁用|取消)自动签到$",
          fnc: "disableAutoSign",
        },
      ],
      task: {
        name: "绝区零米游社自动签到",
        cron: "0 0/10 * * * ?", // 每10分钟扫描各个用户的专属随机时间槽
        fnc: () => zzzSign.autoSignTask(),
      },
    })
  }

  static getHeaders(ck) {
    return {
      "x-rpc-signgame": "zzz",
      "Origin": "https://act.mihoyo.com",
      "Referer": "https://act.mihoyo.com/",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.73 Mobile Safari/537.36 miHoYoBBS/2.73.1",
      "Content-Type": "application/json",
      "Cookie": ck,
    }
  }

  /** 带超时保护的网络请求封装（单请求隔离，防 hang 死） */
  static async fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)
      return res
    } catch (err) {
      clearTimeout(timer)
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        throw new Error(`网络请求超时 (${timeoutMs / 1000}秒)`)
      }
      throw err
    }
  }

  /** 主动撤回过程性消息工具函数 */
  static async recallProcessMsg(e, msgRes) {
    if (!msgRes) return
    const msgId = msgRes.message_id || msgRes.id || (Array.isArray(msgRes) ? msgRes[0]?.message_id : null)
    if (!msgId) return
    try {
      if (e.group?.recallMsg) {
        await e.group.recallMsg(msgId)
      } else if (e.recallMsg) {
        await e.recallMsg(msgId)
      } else if (e.bot?.recallMsg) {
        await e.bot.recallMsg(msgId)
      }
    } catch (err) {
      // 忽略撤回失败（如消息已被系统撤回或权限限制）
    }
  }

  /** 获取用户唯一标识（支持群内主账号映射） */
  static async getUserMainId(e) {
    const user = await NoteUser.create(e)
    if (!user) return null
    return user.targetId || user.qq || e.user_id
  }

  /** 检查用户是否开启了自动签到 */
  static async isUserAutoSignEnabled(mainId) {
    if (!mainId) return false
    return await redis.sIsMember(REDIS_AUTO_USERS_KEY, String(mainId))
  }

  // 1. 指令：单次签到
  async manualSign() {
    const user = await NoteUser.create(this.e)
    if (!user || !user.hasCk) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未检测到绑定的米游社凭据。\n💡 修复指引：请发送 /绑定 扫码登录。")
    }

    const uid = user.getCkUid("zzz")
    if (!uid) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未检测到绝区零游戏角色，请确认该米游社账号已在游戏中创建角色。")
    }

    // 发送明确的过程性提示消息，并设 30 秒兜底自动撤回
    const progress = await this.reply("⏳ 正在执行绝区零米游社签到，请稍候...", false, { recallMsg: 30 })

    const res = await zzzSign.executeSignForUser(user, false)
    await this.reply(res.msg)

    // 发送完最终结果后，主动撤回过程性提示消息，只保留最终干净的结果
    await zzzSign.recallProcessMsg(this.e, progress)
  }

  // 2. 指令：查看签到状态
  async signStatus() {
    const user = await NoteUser.create(this.e)
    if (!user || !user.hasCk) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未检测到绑定的米游社凭据。\n💡 修复指引：请发送 /绑定 扫码登录。")
    }

    const uid = user.getCkUid("zzz")
    const zzzUser = user.getMysUser("zzz")
    const ck = zzzUser?.ck || user.getCookie?.("zzz")
    if (!ck || !uid) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未获取到有效的绝区零Cookie或UID。")
    }

    const mainId = await zzzSign.getUserMainId(this.e)
    const autoEnabled = await zzzSign.isUserAutoSignEnabled(mainId)
    const dateStr = new Date().toISOString().slice(0, 10)
    const userScheduleKey = `ZZZ:SIGN:SCHEDULE:${dateStr}:${mainId}`
    const userSlot = await redis.get(userScheduleKey)

    const infoUrl = `${API_BASE}/info?lang=zh-cn&act_id=${ACT_ID}&region=prod_gf_cn&uid=${uid}`
    try {
      const res = await zzzSign.fetchWithTimeout(infoUrl, {
        method: "GET",
        headers: zzzSign.getHeaders(ck),
      })
      const json = await res.json()
      if (json.retcode === 0 && json.data) {
        const maskedUid = String(uid).replace(/^(\d{2})\d+(\d{2})$/, "$1****$2")
        const autoText = autoEnabled
          ? `🟢 已开启（今日专属时间: ${userSlot || "待调度"}）`
          : "⚪ 未开启（发送 /开启自动签到 启用）"

        const text = [
          `【绝区零米游社签到状态】`,
          `绑定UID: ${maskedUid}`,
          `今日状态: ${json.data.is_sign ? "✅ 已签到" : "⏳ 今日未签到"}`,
          `累计签到: ${json.data.total_sign_day} 天`,
          `漏签天数: ${json.data.sign_cnt_missed || 0} 天`,
          `自动签到: ${autoText}`,
          `当前时间: ${json.data.today || "未知"}`,
        ].join("\n")

        // 尝试生成并发送轻量渲染卡片图
        const tplFile = path.join(process.cwd(), "data", "zzzSign", "status.html")
        if (fs.existsSync(tplFile)) {
          try {
            const puppeteer = (await import("../../lib/puppeteer/puppeteer.js")).default
            const img = await puppeteer.screenshot("zzzSignStatus", {
              tplFile,
              maskedUid,
              isSigned: !!json.data.is_sign,
              todayDate: json.data.today || dateStr,
              totalSignDay: json.data.total_sign_day || 0,
              missedDay: json.data.sign_cnt_missed || 0,
              autoEnabled,
              userSlot: userSlot || "待调度",
            })
            if (img) {
              return this.reply(img)
            }
          } catch (rErr) {
            logger.warn(`[绝区零签到] 状态卡片渲染异常，降级为文本: ${rErr.message}`)
          }
        }

        return this.reply(text)
      } else if (json.retcode === -100 || json.retcode === 10001) {
        return this.reply(`【绝区零米游社签到告警】\n⚠️ 米游社Cookie凭证已过期失效！\n💡 修复指引：请直接发送 /绑定 调出最新二维码扫码重新登录，绑定后将自动恢复正常。`)
      } else {
        return this.reply(`【绝区零米游社签到】\n查询失败 [${json.retcode}]: ${json.message}`)
      }
    } catch (e) {
      return this.reply(`【绝区零米游社签到】\n查询异常: ${e.message}`)
    }
  }

  // 3.1 指令：开启自动签到
  async enableAutoSign() {
    const user = await NoteUser.create(this.e)
    if (!user || !user.hasCk) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未检测到绑定的米游社凭据。\n💡 修复指引：请先发送 /绑定 扫码登录后再开启自动签到。")
    }

    const uid = user.getCkUid("zzz")
    if (!uid) {
      return this.reply("【绝区零米游社签到】\n⚠️ 未检测到绝区零角色，请确认已在游戏中创建角色。")
    }

    const mainId = await zzzSign.getUserMainId(this.e)
    await redis.sAdd(REDIS_AUTO_USERS_KEY, String(mainId))

    // 记录开启用户的来源上下文（用于定时任务精准@群成员通知结果）
    const notifyTarget = {
      group_id: this.e.group_id || null,
      user_id: this.e.user_id,
      self_id: this.e.self_id,
      isGroup: !!this.e.isGroup,
    }
    await redis.set(`ZZZ:SIGN:USER_NOTIFY:${mainId}`, JSON.stringify(notifyTarget), { EX: 86400 * 365 })

    const maskedUid = String(uid).replace(/^(\d{2})\d+(\d{2})$/, "$1****$2")
    const text = [
      `✅ 已成功为 UID:${maskedUid} 开启绝区零每日自动签到！`,
      `• 专属时间：每天 07:00 ~ 22:00 独立随机时间槽（防扎堆风控）`,
      `• 结果反馈：每日执行完毕后将在本群 @您 播报签到结果`,
      `• 失效提醒：若凭证过期失效，将第一时间主动艾特告警`,
      `• 查询状态：发送 /签到状态 随时查看`,
      `• 如需关闭：发送 /关闭自动签到 即可停用`,
    ].join("\n")
    return this.reply(text)
  }

  // 3.2 指令：关闭自动签到
  async disableAutoSign() {
    const mainId = await zzzSign.getUserMainId(this.e)
    if (!mainId) {
      return this.reply("未检测到用户身份信息。")
    }

    await redis.sRem(REDIS_AUTO_USERS_KEY, String(mainId))
    await redis.del(`ZZZ:SIGN:USER_NOTIFY:${mainId}`)
    return this.reply("❌ 已为您关闭绝区零每日自动签到。\n后续可通过 /开启自动签到 随时重新启用。")
  }

  // 核心签到执行函数（单用户）
  static async executeSignForUser(user, isAuto = false) {
    const zzzUser = user.getMysUser ? user.getMysUser("zzz") : null
    const uid = user.getCkUid ? user.getCkUid("zzz") : null
    const ck = zzzUser?.ck || user.getCookie?.("zzz")

    if (!ck || !uid) {
      return { success: false, msg: "【绝区零米游社签到】\n⚠️ 未绑定绝区零Cookie或UID，无法执行签到。" }
    }

    const maskedUid = String(uid).replace(/^(\d{2})\d+(\d{2})$/, "$1****$2")
    const dateStr = new Date().toISOString().slice(0, 10)
    const todayLockKey = `ZZZ:SIGN:DONE:${uid}:${dateStr}`

    // 优化 1：本地先验缓存短路检查（0 网络开销直接跳过）
    const hasDoneLocally = await redis.get(todayLockKey)
    if (hasDoneLocally) {
      logger.info(`[绝区零签到] UID:${maskedUid} 本地已存在今日签到完成标记，直接短路跳过。`)
      return {
        success: true,
        already: true,
        source: "local",
        msg: `【绝区零米游社签到】\nℹ️ 本地记录检测：今日已在机器人端完成签到，无需重复签到。`,
        total: null,
      }
    }

    // 1. 查询官方签到状态（带 8 秒超时保护）
    const infoUrl = `${API_BASE}/info?lang=zh-cn&act_id=${ACT_ID}&region=prod_gf_cn&uid=${uid}`
    let infoJson
    try {
      const infoRes = await zzzSign.fetchWithTimeout(infoUrl, {
        method: "GET",
        headers: zzzSign.getHeaders(ck),
      })
      infoJson = await infoRes.json()
    } catch (e) {
      logger.error(`[绝区零签到] 查询签到状态网络异常 UID:${maskedUid}: ${e.message}`)
      return { success: false, msg: `【绝区零米游社签到】\n⚠️ 网络连接失败，请稍后重试: ${e.message}` }
    }

    if (!infoJson) {
      return { success: false, msg: "【绝区零米游社签到】\n⚠️ 接口未返回数据" }
    }

    // 检查凭据是否失效
    if (infoJson.retcode === -100 || infoJson.retcode === 10001) {
      const alertMsg = `⚠️【绝区零米游社签到告警】UID: ${maskedUid} 米游社凭证(Cookie)已过期失效！\n💡 修复指引：请直接发送 /绑定 调出最新二维码扫码重新登录，绑定后将自动恢复正常。`
      logger.warn(`[绝区零签到] ${alertMsg}`)
      return { success: false, expired: true, msg: alertMsg }
    }

    if (infoJson.retcode !== 0) {
      return {
        success: false,
        msg: `【绝区零米游社签到】\n⚠️ 查询状态失败 [${infoJson.retcode}]: ${infoJson.message}`,
      }
    }

    // 米游社接口检测到今日已在其他途径签到
    if (infoJson.data?.is_sign) {
      await redis.set(todayLockKey, "1", { EX: 86400 * 2 })
      return {
        success: true,
        already: true,
        source: "remote",
        msg: `【绝区零米游社签到】\nℹ️ 米游社接口检测：今日已在米游社App或其他途径完成签到。\n累计签到: ${infoJson.data.total_sign_day} 天`,
        total: infoJson.data.total_sign_day,
      }
    }

    // 2. 执行签到（带 8 秒超时保护）
    const signUrl = `${API_BASE}/sign`
    let signJson
    try {
      const signRes = await zzzSign.fetchWithTimeout(signUrl, {
        method: "POST",
        headers: zzzSign.getHeaders(ck),
        body: JSON.stringify({
          act_id: ACT_ID,
          region: "prod_gf_cn",
          uid: uid,
          lang: "zh-cn",
        }),
      })
      signJson = await signRes.json()
    } catch (e) {
      logger.error(`[绝区零签到] 执行签到网络异常 UID:${maskedUid}: ${e.message}`)
      return { success: false, msg: `【绝区零米游社签到】\n⚠️ 签到请求失败: ${e.message}` }
    }

    // 处理签到返回：区分本次真实签到成功与各种边界状态
    if (signJson.retcode === 0) {
      const totalDay = (infoJson.data?.total_sign_day || 0) + 1
      await redis.set(todayLockKey, "1", { EX: 86400 * 2 })
      logger.mark(`[绝区零签到] UID: ${maskedUid} 签到成功！累计 ${totalDay} 天`)
      return {
        success: true,
        isRealSign: true,
        msg: `【绝区零米游社签到】\n✅ 绝区零米游社签到成功！\n累计签到: ${totalDay} 天`,
        total: totalDay,
      }
    } else if (signJson.retcode === -5003) {
      await redis.set(todayLockKey, "1", { EX: 86400 * 2 })
      return {
        success: true,
        already: true,
        source: "remote",
        msg: `【绝区零米游社签到】\nℹ️ 米游社接口检测：今日已完成签到。\n累计签到: ${infoJson.data?.total_sign_day || 0} 天`,
      }
    } else if (signJson.retcode === 1034) {
      logger.warn(`[绝区零签到] UID: ${maskedUid} 触发米游社极验验证码`)
      return {
        success: false,
        risk: true,
        msg: `【绝区零米游社签到】\n⚠️ 触发米游社极验验证码风控，今日已跳过，请前往米游社App手动签到一次。`,
      }
    } else if (signJson.retcode === -100 || signJson.retcode === 10001) {
      const alertMsg = `⚠️【绝区零米游社签到告警】UID: ${maskedUid} 米游社凭证(Cookie)已过期失效！\n💡 修复指引：请直接发送 /绑定 调出最新二维码扫码重新登录，绑定后将自动恢复自动签到。`
      logger.warn(`[绝区零签到] ${alertMsg}`)
      return { success: false, expired: true, msg: alertMsg }
    } else {
      return {
        success: false,
        msg: `【绝区零米游社签到】\n⚠️ 签到失败 [${signJson.retcode}]: ${signJson.message}`,
      }
    }
  }

  // 定时自动签到任务：用户级独立随机时间槽调度与群内@成员结果反馈
  static async autoSignTask() {
    const cfg = loadConfig()
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const dateStr = now.toISOString().slice(0, 10)

    // 检查是否在允许的时间窗口内
    if (currentHour < cfg.windowStart || currentHour >= cfg.windowEnd) {
      return
    }

    // 获取所有显式开启自动签到的用户集合
    const autoUserIds = await redis.sMembers(REDIS_AUTO_USERS_KEY)
    if (!autoUserIds || autoUserIds.length === 0) {
      return
    }

    // 遍历已开启自动签到的用户，每个用户拥有独立的随机执行时刻
    for (const userId of autoUserIds) {
      try {
        // 1. 获取或生成该用户今天的独立随机时间槽 (HH:mm)
        const userScheduleKey = `ZZZ:SIGN:SCHEDULE:${dateStr}:${userId}`
        let userSlotStr = await redis.get(userScheduleKey)
        if (!userSlotStr) {
          const targetHour = Math.floor(Math.random() * (cfg.windowEnd - cfg.windowStart)) + cfg.windowStart
          const targetMinute = Math.floor(Math.random() * 60)
          userSlotStr = `${targetHour}:${targetMinute}`
          await redis.set(userScheduleKey, userSlotStr, { EX: 86400 * 2 })
          logger.info(`[绝区零签到] 用户 ${userId} 今日独立签到时刻已生成: ${userSlotStr}`)
        }

        const [targetHour, targetMinute] = userSlotStr.split(":").map(Number)

        // 2. 检查当前时刻是否已到达该用户的预设时间
        if (currentHour < targetHour || (currentHour === targetHour && currentMinute < targetMinute)) {
          continue // 该用户时间未到，跳过
        }

        // 3. 检查该用户今天是否已在自动任务中执行过
        const userExecutedKey = `ZZZ:SIGN:AUTO_EXECUTED:${dateStr}:${userId}`
        const hasExecuted = await redis.get(userExecutedKey)
        if (hasExecuted) {
          continue // 今日已调度过该用户，跳过
        }

        // 标记该用户今日已调度，防止重复触发
        await redis.set(userExecutedKey, "1", { EX: 86400 })

        // 4. 解析用户凭据并执行签到
        const user = await NoteUser.create(userId)
        if (!user || !user.hasCk) continue
        const uid = user.getCkUid("zzz")
        if (!uid) continue

        logger.mark(`[绝区零签到] 到达用户 ${userId} (UID:${uid}) 独立时刻 (${userSlotStr})，开始执行签到...`)

        // 单用户执行与超时隔离保护
        const res = await zzzSign.executeSignForUser(user, true)

        // 5. 自动签到结果反馈：向开启自动签到的原群发送通知，并 @指定成员 说明结果
        const notifyRaw = await redis.get(`ZZZ:SIGN:USER_NOTIFY:${userId}`)
        if (notifyRaw) {
          try {
            const notifyTarget = JSON.parse(notifyRaw)
            const bot = Bot[notifyTarget.self_id] || Bot[Object.keys(Bot)[0]]
            if (bot) {
              const notifyText = `【绝区零每日自动签到】\n${res.msg.replace(/^【绝区零米游社签到】\n?/, "")}\n执行时刻: ${userSlotStr}`
              if (notifyTarget.isGroup && notifyTarget.group_id) {
                const group = bot.pickGroup?.(notifyTarget.group_id)
                if (group) {
                  const atElem = global.segment?.at ? global.segment.at(notifyTarget.user_id) : `@${notifyTarget.user_id}`
                  await group.sendMsg([atElem, " ", notifyText]).catch(() => {})
                }
              } else if (notifyTarget.user_id) {
                const friend = bot.pickUser?.(notifyTarget.user_id)
                if (friend) {
                  await friend.sendMsg(notifyText).catch(() => {})
                }
              }
            }
          } catch (e) {
            logger.error(`[绝区零签到] 自动签到结果推送异常 UID:${uid}: ${e.message}`)
          }
        }
      } catch (err) {
        // 单个用户异常隔离，绝对不影响其他用户
        logger.error(`[绝区零签到] 用户 ${userId} 独立调度异常: ${err.message}`)
      }
    }
  }
}
