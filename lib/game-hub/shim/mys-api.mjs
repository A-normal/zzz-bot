/**
 * @file lib/game-hub/shim/mys-api.mjs
 * @description MysApi 兼容垫片：模拟原神 MysApi 基础类，解耦 ZZZ-Plugin 对 genshin/model/mys/mysApi.js 的硬编码继承
 */

import { MihoyoCommunityProvider } from "../../providers/provider-mihoyo.mjs";

const GAME_SERVERS = {
  zzz: ["prod_gf_cn", "prod_gf_cn", "prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"]
};

export default class MysApiShim {
  /**
   * @param {string|number} uid
   * @param {string|Object} cookie
   * @param {Object} [option]
   * @param {boolean} [isZZZ]
   */
  constructor(uid, cookie, option = {}, isZZZ = false) {
    this.uid = uid;
    this.cookie = cookie;
    this.game = isZZZ ? "zzz" : (option.game || "zzz");
    this.server = this.getServer();
    this.option = { log: true, ...option };
    this._device = option.device || "";
    this.provider = global.__gameHubMihoyoProvider || new MihoyoCommunityProvider();
  }

  get device() {
    if (!this._device) {
      this._device = `Hub-${String(this.uid).slice(-5)}`;
    }
    return this._device;
  }

  getServer() {
    const uidStr = String(this.uid || "");
    if (this.game === "zzz") {
      if (uidStr.length < 10) return GAME_SERVERS.zzz[0];
      switch (uidStr.slice(0, -8)) {
        case "10": return GAME_SERVERS.zzz[2];
        case "15": return GAME_SERVERS.zzz[3];
        case "13": return GAME_SERVERS.zzz[4];
        case "17": return GAME_SERVERS.zzz[5];
        default: return GAME_SERVERS.zzz[0];
      }
    }
    return "prod_gf_cn";
  }

  getHeaders(query = "", body = "") {
    return this.provider.buildHeaders({
      query,
      body,
      server: this.server,
      deviceId: this.device,
      cookies: this.cookie
    });
  }

  async getData(type, data = {}) {
    if (typeof this.getUrl === "function") {
      const target = this.getUrl(type, data);
      if (!target) return false;
      return await this.provider.client.request({
        url: target.url,
        method: target.body ? "POST" : "GET",
        headers: target.headers,
        body: target.body
      });
    }
    return false;
  }
}
