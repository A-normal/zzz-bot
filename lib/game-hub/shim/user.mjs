/**
 * @file lib/game-hub/shim/user.mjs
 * @description User 兼容垫片：模拟原神 User 接口，解耦 ZZZ-Plugin 对 genshin/model/user.js 的硬编码依赖
 */

export default class UserShim {
  /**
   * @param {Object} e - Event 对象
   */
  constructor(e) {
    this.e = e || {};
    this.userId = String(this.e.user_id || this.e.userId || "");
  }

  /**
   * 获取指定游戏 UID
   * @param {string} [game='zzz']
   * @returns {string|null}
   */
  getUid(game = "zzz") {
    if (global.__gameHubProviderRegistry) {
      const role = global.__gameHubProviderRegistry.getUserGameRole(this.userId, game)
        || global.__gameHubProviderRegistry.getUserGameRole(`qq-napcat:${this.userId}`, game)
        || global.__gameHubProviderRegistry.getUserGameRole(`telegram:${this.userId}`, game);
      if (role?.uid) return role.uid;
    }
    return this.e?.uid || null;
  }

  /**
   * 针对 ZZZ-Plugin getCk 的直接兼容实现
   * @returns {Record<string, { ck: string, uid: string, ltuid?: string, device_id?: string }>}
   */
  getCk() {
    let role = null;
    if (global.__gameHubProviderRegistry) {
      role = global.__gameHubProviderRegistry.getUserGameRole(this.userId, "zzz")
        || global.__gameHubProviderRegistry.getUserGameRole(`qq-napcat:${this.userId}`, "zzz")
        || global.__gameHubProviderRegistry.getUserGameRole(`telegram:${this.userId}`, "zzz");
    }

    const uid = role?.uid || this.getUid("zzz") || "";
    const cookie = role?.credentials?.cookie || role?.credentials?.ck || (typeof role?.credentials === "string" ? role.credentials : "");

    return {
      default: {
        ck: cookie || "",
        uid: uid,
        ltuid: role?.credentials?.ltuid || "",
        device_id: role?.credentials?.device_id || "hub-device"
      }
    };
  }

  /**
   * 备用老版 mysUser 接口模拟
   */
  async user() {
    const ckData = this.getCk();
    return {
      getMysUser: (game = "zzz") => ({
        ck: ckData.default?.ck || "",
        ltuid: ckData.default?.ltuid || "",
        device: ckData.default?.device_id || "hub-device"
      }),
      getCkUid: (game = "zzz") => ckData.default?.uid || ""
    };
  }
}
