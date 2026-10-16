// Foreground verification of Unified Panel and 3-Command Sign-in Pipeline
process.chdir("/root/Yunzai")

global.logger = new Proxy({}, { get: () => (...a) => a.join(" ") })
global.segment = {}
global.Bot = { makeLog: () => {}, sleep: () => {} }
global.plugin = (await import("/root/Yunzai/lib/plugins/plugin.js")).default

const cfg = (await import("/root/Yunzai/lib/config/config.js")).default
const { zzzShortcuts } = await import("/root/Yunzai/plugins/example/zzzShortcuts.js")

const slashToHash = cfg.bot["/→#"]

function dealText(text = "") {
  if (slashToHash) text = text.replace(/^\s*\/\s*/, "#")
  return text
    .replace(/^\s*[＃井]\s*/, "#")
    .replace(/^\s*[＊※]\s*/, "*")
    .trim()
}

const zzzReg = /^#?(%|％|绝区零|绝区)+/
const srReg = /^#?(\*|星铁|星轨|穹轨|星穹|崩铁|星穹铁道|崩坏星穹铁道|铁道)+/

const RULES = [
  ["ZZZ-Plugin", "help", /^((#|%|\/)?(zzz|ZZZ|绝区零))(帮助|help)$/],
  ["ZZZ-Plugin", "note", /^((#|%|\/)?(zzz|ZZZ|绝区零))(note|每日|体力|便笺|便签)$/],
  ["ZZZ-Plugin", "panel", /^((#|%|\/)?(zzz|ZZZ|绝区零))(.*)面板(展柜)?(刷新|更新|列表)?$/],
  ["ZZZ-Plugin", "gachaAnalysis", /^((#|%|\/)?(zzz|ZZZ|绝区零))抽卡(分析|记录|统计)$/],
  ["ZZZ-Plugin", "gachaRefresh", /^((#|%|\/)?(zzz|ZZZ|绝区零))(刷新|更新)抽卡(链接|记录)?$/],
  ["ZZZ-Plugin", "deadly", /^((#|%|\/)?(zzz|ZZZ|绝区零))(上期|往期)?(危局强袭战|危局|强袭|强袭战)$/],
  ["ZZZ-Plugin", "abyss", /^((#|%|\/)?(zzz|ZZZ|绝区零))(上期|往期)?(式舆防卫战|式舆|深渊|防卫战|防卫)$/],
  ["ZZZ-Plugin", "calendar", /^((#|%|\/)?(zzz|ZZZ|绝区零))(cal|日历)$/],
  ["zzzSign", "manualSign", /^((#|%|\/)?(zzz|ZZZ|绝区零))(社区)?签到$/],
  ["zzzSign", "signStatus", /^((#|%|\/)?(zzz|ZZZ|绝区零))签到状态$/],
  ["zzzSign", "enableAutoSign", /^((#|%|\/)?(zzz|ZZZ|绝区零))(开启|启用)自动签到$/],
  ["zzzSign", "disableAutoSign", /^((#|%|\/)?(zzz|ZZZ|绝区零))(关闭|禁用|取消)自动签到$/],
  ["TRSS-Plugin", "miHoYoLoginQRCode", /(^#?(米哈?游社?登(录|陆|入)|登(录|陆|入)米哈?游社?)|^#(扫码|二维码|辅助)(登录|绑定|登陆))(终止)?$/],
  ["miao-plugin", "profileList", /^#(星铁|原神)?(面板角色|角色面板|面板)(列表)?\s*(\d{9,10})?$/],
  ["genshin", "showUid", /^#(原神|星铁|绝区零)?(我的)?(uid)[0-9]{0,2}$/i],
  ["genshin", "bindUid", /^#(原神|星铁|绝区零)?绑定(uid)?(\s|\+)*((1[0-9]|[1-9])[0-9]{8}|[1-9][0-9]{7})$/i],
]

const INPUTS = [
  // 0. 帮助指令拦截（绝区零帮助）
  ["/帮助", "<@!123456>/帮助", "ZZZ-Plugin:help"],
  ["/help", "<@!123456>/help", "ZZZ-Plugin:help"],
  ["/菜单", "<@!123456>/菜单", "ZZZ-Plugin:help"],
  ["/功能", "<@!123456>/功能", "ZZZ-Plugin:help"],
  ["帮助", "<@!123456>帮助", "ZZZ-Plugin:help"],
  ["%帮助", "<@!123456>%帮助", "ZZZ-Plugin:help"],

  // 1. 便签 / 体力
  ["/便签", "<@!123456>/便签", "ZZZ-Plugin:note"],
  ["/体力", "<@!123456>/体力", "ZZZ-Plugin:note"],
  ["便签", "<@!123456>便签", "ZZZ-Plugin:note"],
  // 2. 抽卡
  ["/抽卡记录", "<@!123456>/抽卡记录", "ZZZ-Plugin:gachaAnalysis"],
  ["/更新抽卡", "<@!123456>/更新抽卡", "ZZZ-Plugin:gachaRefresh"],
  ["抽卡记录", "<@!123456>抽卡记录", "ZZZ-Plugin:gachaAnalysis"],
  // 3. 统一面板：刷新面板（未登录展柜 / 登录默认全角色）
  ["/更新面板", "<@!123456>/更新面板", "ZZZ-Plugin:panel"],
  ["/刷新面板", "<@!123456>/刷新面板", "ZZZ-Plugin:panel"],
  ["更新面板", "<@!123456>更新面板", "ZZZ-Plugin:panel"],
  ["刷新面板", "<@!123456>刷新面板", "ZZZ-Plugin:panel"],
  // 4. 统一面板：查看面板列表
  ["/面板列表", "<@!123456>/面板列表", "ZZZ-Plugin:panel"],
  ["/面板", "<@!123456>/面板", "ZZZ-Plugin:panel"],
  ["面板", "<@!123456>面板", "ZZZ-Plugin:panel"],
  ["面板列表", "<@!123456>面板列表", "ZZZ-Plugin:panel"],
  // 5. 单角色面板
  ["/面板 简", "<@!123456>/面板 简", "ZZZ-Plugin:panel"],
  // 6. 签到功能指令1：单次签到
  ["/签到", "<@!123456>/签到", "zzzSign:manualSign"],
  ["/zzz签到", "<@!123456>/zzz签到", "zzzSign:manualSign"],
  ["签到", "<@!123456>签到", "zzzSign:manualSign"],
  // 7. 签到功能指令2：查看签到状态
  ["/签到状态", "<@!123456>/签到状态", "zzzSign:signStatus"],
  ["签到状态", "<@!123456>签到状态", "zzzSign:signStatus"],
  // 8. 签到功能指令3：开启/关闭自动签到（指令驱动）
  ["/开启自动签到", "<@!123456>/开启自动签到", "zzzSign:enableAutoSign"],
  ["/关闭自动签到", "<@!123456>/关闭自动签到", "zzzSign:disableAutoSign"],
  ["开启自动签到", "<@!123456>开启自动签到", "zzzSign:enableAutoSign"],
  ["关闭自动签到", "<@!123456>关闭自动签到", "zzzSign:disableAutoSign"],
  // 9. UID & 绑定
  ["/uid", "<@!123456>/uid", "genshin:showUid"],
  ["uid", "<@!123456>uid", "genshin:showUid"],
  ["/绑定", "<@!123456>/绑定", "TRSS-Plugin:miHoYoLoginQRCode"],
  ["/绑定 17708598", "<@!123456>/绑定 17708598", "genshin:bindUid"],
  // 10. 原生命令保护（原神 miao-plugin 绝不被抢占）
  ["#面板", "<@!123456>#面板", "miao-plugin:profileList"],
  ["#面板列表", "<@!123456>#面板列表", "miao-plugin:profileList"],
  ["%更新面板", "<@!123456>%更新面板", "ZZZ-Plugin:panel"],
  ["%面板", "<@!123456>%面板", "ZZZ-Plugin:panel"],

  // 11. 原生“%”非快捷指令正常透传，完全不受快捷指令拦截器影响
  ["%强袭战", "<@!123456>%强袭战", "ZZZ-Plugin:deadly"],
  ["%深渊", "<@!123456>%深渊", "ZZZ-Plugin:abyss"],
  ["%日历", "<@!123456>%日历", "ZZZ-Plugin:calendar"],

  // 12. 非法 / 未识别的“/”快捷指令：严格拦截报错并彻底阻断向下穿透（BLOCKED）
  ["/未知指令", "<@!123456>/未知指令", "BLOCKED"],
  ["/原神深渊", "<@!123456>/原神深渊", "BLOCKED"],
  ["/深渊", "<@!123456>/深渊", "BLOCKED"],
  ["/强袭战", "<@!123456>/强袭战", "BLOCKED"],
  ["/test", "<@!123456>/test", "BLOCKED"],
]

async function run(input, raw) {
  let msg = dealText(input)
  const afterDeal = msg
  let replyMsg = null
  const e = {
    msg,
    isGroup: true,
    raw_message: raw,
    reply: async (text) => {
      replyMsg = text
    }
  }
  const inst = new zzzShortcuts()
  inst.e = e
  const acceptRes = await inst.accept(e)
  if (acceptRes === "return") {
    return { afterDeal, afterAccept: "[BLOCKED]", final: "[BLOCKED]", matched: "BLOCKED", replyMsg }
  }
  msg = e.msg
  const afterAccept = msg
  if (srReg.test(msg)) msg = msg.replace(srReg, "#星铁")
  else if (zzzReg.test(msg)) msg = msg.replace(zzzReg, "#绝区零")
  let matched = "NO MATCH"
  for (const [p, f, reg] of RULES) {
    if (reg.test(msg)) {
      matched = `${p}:${f}`
      break
    }
  }
  return { afterDeal, afterAccept, final: msg, matched, replyMsg }
}

console.log("=".repeat(128))
console.log("输入".padEnd(16), "dealText后".padEnd(14), "accept后".padEnd(22), "内核归一后".padEnd(24), "实际命中".padEnd(30), "判定")
console.log("=".repeat(128))
let pass = 0, fail = 0
for (const [input, raw, expected] of INPUTS) {
  const r = await run(input, raw)
  const ok = r.matched === expected
  ok ? pass++ : fail++
  console.log(
    input.padEnd(16),
    r.afterDeal.padEnd(14),
    r.afterAccept.padEnd(22),
    r.final.padEnd(24),
    r.matched.padEnd(30),
    ok ? "PASS" : `FAIL(期望 ${expected})`,
  )
}
console.log("=".repeat(128))
console.log(`合计: PASS=${pass}  FAIL=${fail}`)
process.exit(fail === 0 ? 0 : 1)
