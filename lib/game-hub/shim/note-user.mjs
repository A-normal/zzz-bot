/**
 * @file lib/game-hub/shim/note-user.mjs
 * @description NoteUser 兼容垫片：模拟原神 NoteUser 接口，解耦 ZZZ-Plugin 对 genshin/model/mys/NoteUser.js 的硬编码依赖
 */

export default class NoteUserShim {
  /**
   * @param {string|number} userId
   * @param {Object} [options]
   */
  constructor(userId, options = {}) {
    this.userId = String(userId || "");
    this.options = options;
  }

  /**
   * 静态工厂方法 NoteUser.create(e)
   * @param {any} user - Event 对象或包含 user_id 的对象或纯 ID
   * @returns {Promise<NoteUserShim>}
   */
  static async create(user) {
    let id = "";
    if (typeof user === "string" || typeof user === "number") {
      id = String(user);
    } else if (user && typeof user === "object") {
      id = String(user.user_id || user.userId || user.qq || "");
    }
    return new NoteUserShim(id, { rawUser: user });
  }

  /**
   * 获取指定游戏 UID，默认为绝区零
   * @param {string} [game='zzz']
   * @returns {string|null}
   */
  getUid(game = "zzz") {
    // 1. 优先从全局 Game-Hub 注册表查找
    if (global.__gameHubProviderRegistry) {
      // 遍历前缀匹配
      const role = global.__gameHubProviderRegistry.getUserGameRole(this.userId, game)
        || global.__gameHubProviderRegistry.getUserGameRole(`qq-napcat:${this.userId}`, game)
        || global.__gameHubProviderRegistry.getUserGameRole(`qq-official:${this.userId}`, game)
        || global.__gameHubProviderRegistry.getUserGameRole(`telegram:${this.userId}`, game);
      if (role?.uid) return role.uid;
    }

    // 2. 从实例绑定的 mock/options 数据查找
    if (this.options?.uids && this.options.uids[game]) {
      return this.options.uids[game];
    }

    return null;
  }

  /**
   * 获取已绑定的 Cookie 关联 UID 列表
   * @param {string} [game='zzz']
   * @returns {Array<{ uid: string, ck?: string }>}
   */
  getCkUidList(game = "zzz") {
    const uid = this.getUid(game);
    return uid ? [{ uid }] : [];
  }
}
