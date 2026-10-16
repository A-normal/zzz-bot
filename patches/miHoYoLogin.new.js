import config from "../Model/config.js"
import QR from "qrcode"
import _ from "lodash"
import crypto from "crypto"
import fetch from "node-fetch"

const regex = "^#?(米哈?游社?登(录|陆|入)|登(录|陆|入)米哈?游社?)"

function random_string(n) {
  return _.sampleSize("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", n).join("")
}

function md5(data) {
  return crypto.createHash("md5").update(data).digest("hex")
}

function ds(data) {
  const t = Math.floor(Date.now() / 1000)
  const r = random_string(6)
  const h = md5(`salt=JwYDpKvLj6MrMqqYU6jTKF17KNO2PXoS&t=${t}&r=${r}&b=${data}&q=`)
  return `${t},${r},${h}`
}

function request(url, { data, aigis, cookie } = {}) {
  const opts = {}
  if (data) {
    opts.method = "post"
    opts.body = JSON.stringify(data)
  }
  opts.headers = {
    "x-rpc-app_version": "2.104.0",
    DS: ds(opts.body ?? ""),
    "x-rpc-aigis": aigis,
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-rpc-game_biz": "bbs_cn",
    "x-rpc-sys_version": "12",
    "x-rpc-device_id": random_string(16),
    "x-rpc-device_fp": random_string(13),
    "x-rpc-device_name": random_string(16),
    "x-rpc-device_model": random_string(16),
    "x-rpc-app_id": "bll8iq97cem8",
    "x-rpc-client_type": "2",
    "User-Agent": "Hyperion/550 CFNetwork/3860.500.112 Darwin/25.4.0",
    Cookie: cookie,
  }
  return fetch(url, opts)
}

function app_request(url, { data, device_id }) {
  return fetch(url, {
    method: "post",
    body: data ? JSON.stringify(data) : "{}",
    headers: {
      "User-Agent": "HYPContainer/1.3.3.182",
      "x-rpc-app_id": "ddxf5dufpuyo",
      "x-rpc-client_type": "3",
      "x-rpc-device_id": device_id,
    },
  })
}

const web_headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "x-rpc-app_id": "bll8iq97cem8",
  "x-rpc-device_id": random_string(16),
}

const errorTips = [
  "登录失败，请检查日志\n如果【米哈游登录】无法使用，请尝试【米游社登录】\nhttps://git.trss.me/TRSS-Plugin",
  segment.button([
    { text: "米哈游登录", callback: "米哈游登录" },
    { text: "米游社登录", callback: "米游社登录" },
  ]),
]
const accounts = {}
const Running = {}

export class miHoYoLogin extends plugin {
  constructor() {
    super({
      name: "米哈游登录",
      dsc: "米哈游扫码登录",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: `(${regex}|^#(扫码|二维码|辅助)(登录|绑定|登陆))(终止)?$`,
          fnc: "miHoYoLoginQRCode",
        },
        {
          reg: "^#?(体力|(c|C)(oo)?k(ie)?|(s|S)(to)?k(en)?)(帮助|教程)$",
          fnc: "miHoYoLoginHelp",
        },
      ],
    })
  }

  async miHoYoLoginQRCode() {
    if (this.e.msg.includes("终止")) {
      Running[this.e.user_id] = false
      return true
    }

    if (Running[this.e.user_id])
      return this.reply(
        [
          "请使用米游社扫码登录",
          Running[this.e.user_id],
          segment.button([{ text: "终止登录", callback: "米哈游登录终止" }]),
        ],
        true,
        {
          recallMsg: 60,
        },
      )
    Running[this.e.user_id] = true

    if (this.e.msg.includes("米游社")) return this.HyperionLogin()

    const device_id = random_string(16)
    let res, ticket
    try {
      res = await app_request(
        "https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin",
        { device_id },
      )
      res = await res.json()
      logger.mark(`${this.e.logFnc} 二维码已创建`)

      const url = res.data.url
      ticket = res.data.ticket
      const img = segment.image(
        (await QR.toDataURL(url)).replace("data:image/png;base64,", "base64://"),
      )
      Running[this.e.user_id] = img
      this.reply(
        [
          "请使用米游社扫码登录",
          img,
          segment.button([{ text: "终止登录", callback: "米哈游登录终止" }]),
        ],
        true,
        { recallMsg: 60 },
      )
    } catch (err) {
      Running[this.e.user_id] = false
      return logger.error(this.e.logFnc, err)
    }

    let data, Scanned
    for (let n = 1; n < 60; n++) {
      await Bot.sleep(5000)
      if (Running[this.e.user_id] === false)
        return this.reply(
          [
            "米哈游登录已终止",
            segment.button([
              { text: "米哈游登录", callback: "米哈游登录" },
              { text: "米游社登录", callback: "米游社登录" },
            ]),
          ],
          true,
          { recallMsg: 60 },
        )
      try {
        res = await app_request(
          "https://passport-api.mihoyo.com/account/ma-cn-passport/app/queryQRLoginStatus",
          {
            device_id,
            data: { ticket },
          },
        )
        res = await res.json()

        if (res.retcode !== 0) {
          Running[this.e.user_id] = false
          return this.reply(
            [
              "二维码已过期，请重新登录",
              segment.button([
                { text: "米哈游登录", callback: "米哈游登录" },
                { text: "米游社登录", callback: "米游社登录" },
              ]),
            ],
            true,
            { recallMsg: 60 },
          )
        }

        if (res.data.status === "Scanned" && !Scanned) {
          logger.mark(`${this.e.logFnc} 二维码已扫描`)
          Scanned = true
          this.reply(
            [
              "二维码已扫描，请确认登录",
              segment.button([{ text: "终止登录", callback: "米哈游登录终止" }]),
            ],
            true,
            { recallMsg: 60 },
          )
        }

        if (res.data.status === "Confirmed") {
          logger.mark(`${this.e.logFnc} 扫码已确认`)
          break
        }
      } catch (err) {
        logger.error(this.e.logFnc, err)
      }
    }
    Running[this.e.user_id] = false

    const cookie = []
    try {
      if (!(res.data?.tokens && res.data?.user_info))
        return this.reply(errorTips, true, { recallMsg: 60 })

      const uid = res.data.user_info.aid || res.data.user_info.uid || res.data.user_info.account_id,
        token = (
          res.data.tokens.find(i => i.name === "stoken" || i.name === "stoken_v2") ||
          res.data.tokens[0]
        )?.token,
        mid = res.data.user_info.mid
      if (!(uid && token && mid)) return this.reply(errorTips, true, { recallMsg: 60 })

      cookie.push(`stoken=${token};stuid=${uid};mid=${mid}`)
      res = await request(
        `https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken?stoken=${token}&uid=${uid}&mid=${mid}`,
        { cookie: cookie[0] },
      )
      res = await res.json()
      logger.mark(`${this.e.logFnc} 凭据获取成功，已内部派发绑定`)

      if (!res.data?.cookie_token) return this.reply(errorTips, true, { recallMsg: 60 })
      cookie.push(`ltoken=${token};ltuid=${uid};cookie_token=${res.data.cookie_token}`)
    } catch (err) {
      logger.error(this.e.logFnc, err)
      return this.reply(errorTips, true, { recallMsg: 60 })
    }

    for (const i of cookie) this.makeMessage(i)
    this.reply("登录完成，凭据已自动绑定", true, { recallMsg: 60 })
  }

  async HyperionLogin() {
    let res, ticket
    try {
      res = await fetch(
        "https://passport-api.mihoyo.com/account/ma-cn-passport/web/createQRLogin",
        { headers: web_headers, method: "post", body: "{}" },
      )
      res = await res.json()
      logger.mark(`${this.e.logFnc} 米游社二维码已创建`)

      const url = res.data.url
      ticket = res.data.ticket
      const img = segment.image(
        (await QR.toDataURL(url)).replace("data:image/png;base64,", "base64://"),
      )
      Running[this.e.user_id] = img
      this.reply(
        [
          "请使用米游社扫码登录",
          img,
          segment.button([{ text: "终止登录", callback: "米游社登录终止" }]),
        ],
        true,
        { recallMsg: 60 },
      )
    } catch (err) {
      Running[this.e.user_id] = false
      logger.error(this.e.logFnc, err)
      return this.reply(errorTips, true, { recallMsg: 60 })
    }

    let cookie, Scanned
    for (let n = 1; n < 60; n++) {
      await Bot.sleep(5000)
      if (Running[this.e.user_id] === false)
        return this.reply(
          [
            "米游社登录已终止",
            segment.button([
              { text: "米哈游登录", callback: "米哈游登录" },
              { text: "米游社登录", callback: "米游社登录" },
            ]),
          ],
          true,
          { recallMsg: 60 },
        )
      try {
        res = await fetch(
          "https://passport-api.mihoyo.com/account/ma-cn-passport/web/queryQRLoginStatus",
          { headers: web_headers, method: "post", body: JSON.stringify({ ticket }) },
        )
        cookie = res.headers.getSetCookie()
        res = await res.json()

        if (res.retcode !== 0) {
          Running[this.e.user_id] = false
          return this.reply(
            [
              "二维码已过期，请重新登录",
              segment.button([
                { text: "米哈游登录", callback: "米哈游登录" },
                { text: "米游社登录", callback: "米游社登录" },
              ]),
            ],
            true,
            { recallMsg: 60 },
          )
        }

        if (res.data.status === "Scanned" && !Scanned) {
          logger.mark(`${this.e.logFnc} 米游社二维码已扫描`)
          Scanned = true
          this.reply(
            [
              "二维码已扫描，请确认登录",
              segment.button([{ text: "终止登录", callback: "米游社登录终止" }]),
            ],
            true,
            { recallMsg: 60 },
          )
        }

        if (res.data.status === "Confirmed") {
          logger.mark(`${this.e.logFnc} 米游社扫码已确认，已内部派发绑定`)
          break
        }
      } catch (err) {
        logger.error(this.e.logFnc, err)
      }
    }
    Running[this.e.user_id] = false

    if (!cookie?.length) return this.reply(errorTips, true, { recallMsg: 60 })

    cookie = cookie.map(i => i.split(";")[0]).join(";")
    this.makeMessage(cookie)
    this.reply("登录完成，凭据已自动绑定", true, { recallMsg: 60 })
  }

  makeMessage(msg) {
    Bot.em("message.private.friend", {
      self_id: this.e.self_id,
      message_id: this.e.message_id,
      user_id: this.e.user_id,
      sender: this.e.sender,
      friend: this.e.friend,
      reply: (msg, quote, opts) => this.reply(msg, quote, { ...opts, recallMsg: 60 }),
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      message: [{ type: "text", text: msg }],
      raw_message: msg,
    })
  }

  miHoYoLoginHelp() {
    if (!config.miHoYoLogin.help) return false
    this.reply(
      [
        "优先发送【米哈游登录】\n如果无法登录发送【米游社登录】",
        segment.button([
          { text: "米哈游登录", callback: "米哈游登录" },
          { text: "米游社登录", callback: "米游社登录" },
        ]),
      ],
      true,
    )
  }
}
