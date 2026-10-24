import plugin from "../../lib/plugins/plugin.js"
import { parseMasterCommand } from "./aiChatCore.mjs"

/**
 * 可选的指令前缀。
 * 必须同时接受：
 *   - 无前缀    便签
 *   - 半角斜杠  /便签   （QQ 快捷指令原始输入）
 *   - 半角井号  #便签   （云崽内核 dealText 会把行首 / 改写成 #）
 *   - 全角井号  ＃便签
 *   - 半角百分号 %便签
 *   - 全角百分号 ％便签
 * 原因：lib/plugins/loader.js 的 dealText() 在 accept() 之前就把行首 "/" 改写为 "#"，
 * 因此 accept() 里永远看不到 "/"，必须把 "#" 也纳入匹配。
 */
const P = "[\\/#＃%％]?"

export class zzzShortcuts extends plugin {
  constructor() {
    super({
      name: "绝区零快捷指令映射",
      dsc: "将 QQ 群快捷指令（/ 与纯词）统一映射为 ZZZ-Plugin 标准原生指令",
      event: "message",
      priority: -1000,
    })
  }

  /** 判断原始消息是否为斜杠快捷指令（raw_message 不经过内核 dealText 改写） */
  isSlashInput(e) {
    const raw = typeof e.raw_message === "string" ? e.raw_message : ""
    if (raw) {
      const cleaned = raw
        .replace(/<@!?\d+>/g, "")
        .replace(/\[CQ:[^\]]*\]/g, "")
        .trim()
      if (/^[/／]/.test(cleaned)) return true
    }
    const orig = typeof e.original_msg === "string" ? e.original_msg.trim() : ""
    if (/^[/／]/.test(orig)) return true
    const current = typeof e.msg === "string" ? e.msg.trim() : ""
    if (/^[/／]/.test(current)) return true
    return false
  }

  async accept(e) {
    // 给事件打"已回复"标记：兜底 AI 路由据此让位，避免别的插件 return false 后被重复回复
    if (e && typeof e.reply === "function" && !e._replyWrapped) {
      e._replyWrapped = true
      const original = e.reply
      e.reply = async function (...args) {
        e._replied = true
        return original.apply(e, args)
      }
    }
    if (!e.msg) return false
    const msg = e.msg.trim()

    // 0.0 主人专用：/模型、/模型列表、/模型接口（交给 AI 模块，避免落入"未识别快捷指令"拦截）
    const masterCmd = parseMasterCommand(msg)
    if (masterCmd) {
      try {
        const { handleMasterCommand } = await import("./aiChatControl.mjs")
        await handleMasterCommand(e, masterCmd.kind, masterCmd.arg)
      } catch (err) {
        logger.error("[AI] 主命令处理失败", err)
        await e.reply("AI 模块未就绪，请检查 data/aiChat/config.yaml")
      }
      return "return"
    }

    let target = null

    // 0. 帮助 / 菜单 / 功能 / 指令说明：/帮助, /help, /菜单, /功能, /指令, 帮助, help
    if (new RegExp(`^${P}(帮助|help|菜单|功能|说明|指令)$`, "i").test(msg)) {
      target = "#绝区零帮助"
    }

    // 1. 抽卡分析 / 抽卡记录 / 抽卡统计
    else if (new RegExp(`^${P}(抽卡记录|抽卡分析|抽卡统计)$`, "i").test(msg)) {
      target = "#绝区零抽卡分析"
    }

    // 2. 更新 / 刷新抽卡
    else if (new RegExp(`^${P}(更新抽卡|刷新抽卡|更新抽卡记录|刷新抽卡记录)$`, "i").test(msg)) {
      target = "#绝区零更新抽卡"
    }

    // 3. 便签 / 体力 / 每日
    else if (new RegExp(`^${P}(便签|便笺|体力|每日|note)$`, "i").test(msg)) {
      target = "#绝区零便签"
    }

    // 4.0 更新展柜：/更新展柜, /刷新展柜, 更新展柜, 刷新展柜, /更新展柜面板, 更新展柜面板
    else if (new RegExp(`^${P}(更新展柜|刷新展柜|展柜更新|展柜刷新|更新展柜面板)$`, "i").test(msg)) {
      const isSlash = this.isSlashInput(e)
      const isBareWord = /^(更新展柜|刷新展柜|展柜更新|展柜刷新|更新展柜面板)/.test(msg)
      if (isSlash || isBareWord) target = "#绝区零更新展柜"
    }

    // 4.1 单角色更新面板：/更新面板 艾莲, 更新面板 艾莲, /刷新面板 简
    else if (new RegExp(`^${P}(更新面板|刷新面板)\\s+(.+)$`, "i").test(msg)) {
      const role = msg.match(new RegExp(`^${P}(更新面板|刷新面板)\\s+(.+)$`, "i"))[2].trim()
      target = `#绝区零更新面板 ${role}`
    }

    // 4.2 全量更新面板：/更新面板, /刷新面板, 更新面板, 刷新面板
    //     规避原神 miao-plugin 抢占 "#更新面板"
    else if (new RegExp(`^${P}(更新面板|刷新面板|全角色面板)$`, "i").test(msg)) {
      const isSlash = this.isSlashInput(e)
      const isBareWord = /^(更新面板|刷新面板|全角色面板)/.test(msg)
      if (isSlash || isBareWord) target = "#绝区零更新面板"
    }

    // 4.3 查看面板：/面板, /面板列表, 面板, 面板列表
    //     消歧策略：只有确认为【斜杠快捷指令】或【完全无前缀的纯词】时才映射为绝区零，
    //     原生 "#面板" / "#面板列表"（原神）保持不动，避免抢占原神面板。
    else if (new RegExp(`^${P}面板(列表)?$`, "i").test(msg)) {
      const isSlash = this.isSlashInput(e)
      const isBareWord = /^面板/.test(msg)
      if (isSlash || isBareWord) target = "#绝区零面板列表"
    }

    // 4.4 单角色面板查询：/面板 简, 面板 简
    else if (new RegExp(`^${P}面板\\s+(.+)$`, "i").test(msg)) {
      const role = msg.match(new RegExp(`^${P}面板\\s+(.+)$`, "i"))[1].trim()
      target = `#绝区零${role}面板`
    }

    // 5. UID 查询
    else if (new RegExp(`^${P}(uid|我的uid|查uid)$`, "i").test(msg)) {
      target = "#绝区零uid"
    }

    // 6. 绑定：/绑定 <UID> 直接绑定，或 /绑定 调起扫码
    else if (new RegExp(`^${P}绑定\\s*(\\d{7,10})$`, "i").test(msg)) {
      const uid = msg.match(new RegExp(`^${P}绑定\\s*(\\d{7,10})$`, "i"))[1]
      target = `#绝区零绑定 ${uid}`
    } else if (new RegExp(`^${P}(绑定|扫码绑定|扫码登录|扫码)$`, "i").test(msg)) {
      target = "#扫码登录"
    }

    // 7. 绝区零签到（三项功能指令）
    // 7.1 单次签到：/签到, /zzz签到, 签到
    else if (new RegExp(`^${P}(zzz|ZZZ|绝区零)?(社区)?签到$`, "i").test(msg)) {
      target = "#绝区零签到"
    }
    // 7.2 查看签到状态：/签到状态, 签到状态
    else if (new RegExp(`^${P}(zzz|ZZZ|绝区零)?签到状态$`, "i").test(msg)) {
      target = "#绝区零签到状态"
    }
    // 7.3 开启/关闭自动签到（指令控制，非默认开启）
    else if (new RegExp(`^${P}(zzz|ZZZ|绝区零)?(开启|启用)自动签到$`, "i").test(msg)) {
      target = "#绝区零开启自动签到"
    } else if (new RegExp(`^${P}(zzz|ZZZ|绝区零)?(关闭|禁用|取消)自动签到$`, "i").test(msg)) {
      target = "#绝区零关闭自动签到"
    }

    // 8. 迷宫诡域 / 贝果计划（搜打撤）
    // 8.1 战绩详情（优先匹配战绩/详情长词）：/贝果战绩, /更新贝果战绩, 贝果计划战绩, /迷宫战绩
    else if (new RegExp(`^${P}(更新|刷新)?(贝果|贝果计划|迷宫|迷宫诡域|搜打撤|绝科夫)(战绩|记录|详情|回顾)$`, "i").test(msg)) {
      target = "#绝区零贝果战绩"
    }
    // 8.2 迷宫总览：/贝果, /贝果计划, /更新贝果, 贝果, /迷宫, 搜打撤
    else if (new RegExp(`^${P}(更新|刷新)?(贝果|贝果计划|迷宫|迷宫诡域|搜打撤|绝科夫)$`, "i").test(msg)) {
      target = "#绝区零贝果"
    }

    // 9. 兑换码 / code：/兑换码, /code, 兑换码, code, %兑换码, #兑换码
    else if (new RegExp(`^${P}(code|兑换码|前瞻兑换码|直播兑换码)$`, "i").test(msg)) {
      target = "#绝区零兑换码"
    }

    // 10. 日历 / cal：/日历, /cal, 日历, cal, %日历
    else if (new RegExp(`^${P}(cal|日历|活动日历)$`, "i").test(msg)) {
      target = "#绝区零日历"
    }

    // 11. 月报 / 菲林统计：/月报, 月报, %月报, /菲林, 菲林
    else if (new RegExp(`^${P}(?:(\\d{4})年)?(?:(\\d{1,2}|上)月)?(monthly|菲林|邦布券|收入|月报)(?:(\\d{4})年)?(?:(\\d{1,2}|上)月)?(统计)?$`, "i").test(msg)) {
      target = `#绝区零${msg.replace(new RegExp(`^${P}`), "")}`
    }

    if (target) {
      e.msg = target
      if (target.startsWith("#绝区零")) e.game = "zzz"
      return false
    }

    // 9. 非法 / 未识别快捷指令统一拦截并报错，彻底防止错误指令穿透至原神等其他模块
    if (this.isSlashInput(e)) {
      const raw = typeof e.raw_message === "string" && e.raw_message ? e.raw_message : (e.original_msg || e.msg || "")
      const cleaned = raw.replace(/<@!?\d+>/g, "").replace(/\[CQ:[^\]]*\]/g, "").trim()
      const cmd = cleaned.replace(/^[/／#＃]+/, "").trim().split(/\s+/)[0]
      const tip = cmd ? `没有快捷指令“/${cmd}”，可发送 /帮助 查看支持的快捷指令。` : "没有这条快捷指令，可发送 /帮助 查看支持的快捷指令。"
      await e.reply(tip, true)
      return "return"
    }

    return false
  }
}
