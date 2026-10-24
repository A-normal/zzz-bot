/**
 * @file lib/providers/provider-mihoyo.mjs
 * @description 米哈游 / 米游社底层社区驱动 SPI 实现 (Mihoyo Community Provider)
 */

import crypto from "node:crypto";

function md5(str) {
  return crypto.createHash("md5").update(String(str)).digest("hex");
}

function randomString(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export class MihoyoCommunityProvider {
  constructor(options = {}) {
    this.id = "mihoyo";
    this.name = "米游社";
    this.appVersion = options.appVersion || "2.71.1";
    this.clientType = options.clientType || "5";

    // 默认 Salt 列表
    this.salts = {
      cn_ds1: "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs",
      os_ds1: "okr4obncj8bw5a65hbnn5oo6ixjc3l9w",
      bbs_ds2: "WGtruoQrwczmsjLOPXzJLnaAYycsLavx",
      ...(options.salts || {})
    };

    this.auth = {
      createQrCode: this.createQrCode.bind(this),
      pollQrStatus: this.pollQrStatus.bind(this),
      refreshCredentials: this.refreshCredentials.bind(this)
    };

    this.roles = {
      fetchGameRoles: this.fetchGameRoles.bind(this)
    };

    this.client = {
      request: this.request.bind(this)
    };
  }

  /**
   * 计算 Takumi DS1 动态签名
   * @param {string} [query=""]
   * @param {string} [body=""]
   * @param {string} [server="prod_gf_cn"]
   * @returns {string} `${t},${r},${hash}`
   */
  getDs1(query = "", body = "", server = "prod_gf_cn") {
    const salt = server === "prod_gf_cn" ? this.salts.cn_ds1 : this.salts.os_ds1;
    const t = Math.round(Date.now() / 1000);
    const r = Math.floor(Math.random() * 900000 + 100000);
    const hash = md5(`salt=${salt}&t=${t}&r=${r}&b=${body}&q=${query}`);
    return `${t},${r},${hash}`;
  }

  /**
   * 计算 BBS DS2 动态签名
   * @returns {string}
   */
  getDs2() {
    const t = Math.round(Date.now() / 1000);
    const r = randomString(6);
    const hash = md5(`salt=${this.salts.bbs_ds2}&t=${t}&r=${r}`);
    return `${t},${r},${hash}`;
  }

  /**
   * 构造标准 Takumi 请求请求头
   * @param {Object} [options]
   * @returns {Record<string, string>}
   */
  buildHeaders(options = {}) {
    const { query = "", body = "", server = "prod_gf_cn", deviceId = "", deviceFp = "", cookies = "" } = options;
    const headers = {
      "x-rpc-app_version": this.appVersion,
      "x-rpc-client_type": this.clientType,
      "x-rpc-device_id": deviceId || randomString(32),
      DS: this.getDs1(query, body, server),
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8"
    };

    if (deviceFp) {
      headers["x-rpc-device_fp"] = deviceFp;
    }

    if (cookies) {
      headers.Cookie = typeof cookies === "object"
        ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
        : String(cookies);
    }

    return headers;
  }

  /**
   * 生成米哈游客户端扫码二维码
   */
  async createQrCode() {
    const url = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/createQRLogin";
    const body = JSON.stringify({ app_id: "bll8iq97cem8" });
    const res = await this.client.request({
      url,
      method: "POST",
      body,
      noDs: true
    });
    if (res?.data?.url) {
      return {
        qrUrl: res.data.url,
        ticket: res.data.ticket
      };
    }
    return { qrUrl: "", ticket: "" };
  }

  /**
   * 轮询扫码状态
   */
  async pollQrStatus(ticket) {
    const url = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/queryQRLoginStatus";
    const body = JSON.stringify({ ticket, app_id: "bll8iq97cem8" });
    const res = await this.client.request({
      url,
      method: "POST",
      body,
      noDs: true
    });
    const statusMap = {
      Created: "waiting",
      Scanned: "scanned",
      Confirmed: "confirmed"
    };
    const stat = res?.data?.status || "waiting";
    return {
      status: statusMap[stat] || "waiting",
      credentials: res?.data?.tokens || null
    };
  }

  /**
   * 刷新通行证凭据
   */
  async refreshCredentials(_credentials) {
    return true;
  }

  /**
   * 拉取该账号绑定的全量游戏角色清单
   */
  async fetchGameRoles(credentials = {}) {
    const url = "https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie";
    const res = await this.client.request({
      url,
      method: "GET",
      credentials
    });
    if (res?.data?.list && Array.isArray(res.data.list)) {
      return res.data.list.map(r => ({
        gameId: r.game_biz === "nap_cn" ? "zzz" : r.game_biz === "hkrpg_cn" ? "hsr" : "genshin",
        uid: r.game_uid,
        region: r.region,
        nickname: r.nickname,
        level: r.level
      }));
    }
    return [];
  }

  /**
   * 标准网络请求客户端
   */
  async request(options = {}) {
    const { url, method = "GET", query = "", body = "", credentials = {}, headers = {}, noDs = false } = options;
    const reqHeaders = {
      ...this.buildHeaders({
        query: typeof query === "object" ? new URLSearchParams(query).toString() : query,
        body: typeof body === "object" ? JSON.stringify(body) : body,
        cookies: credentials.cookies || credentials
      }),
      ...headers
    };

    if (noDs) {
      delete reqHeaders.DS;
    }

    let fetchFn = global.fetch;
    if (typeof fetchFn !== "function") {
      fetchFn = (await import("node-fetch")).default;
    }

    try {
      const resp = await fetchFn(url, {
        method,
        headers: reqHeaders,
        body: method === "POST" && body ? (typeof body === "object" ? JSON.stringify(body) : body) : undefined
      });
      return await resp.json();
    } catch (err) {
      return { retcode: -1, message: err.message || "Network Error" };
    }
  }
}
