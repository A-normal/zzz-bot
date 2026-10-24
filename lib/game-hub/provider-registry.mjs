/**
 * @file lib/game-hub/provider-registry.mjs
 * @description 社区驱动 SPI 注册表与上下文装配中枢
 */

export class CommunityProviderRegistry {
  constructor() {
    /** @type {Map<string, import('./types.mjs').ICommunityProvider>} */
    this.providers = new Map();

    /**
     * 用户游戏绑定与通行证存储（轻量级内存池，生产环境对接 SQLite / Global Identity Vault）
     * Key: `${unifiedUserId}:${gameId}` -> { uid, providerId, credentials }
     * @type {Map<string, { uid: string, providerId: string, credentials?: any }>}
     */
    this.userBindings = new Map();
  }

  /**
   * 注册底层社区驱动
   * @param {import('./types.mjs').ICommunityProvider} provider
   */
  register(provider) {
    if (!provider || !provider.id) {
      throw new Error("[CommunityProviderRegistry] Provider must have a valid id");
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * 卸载社区驱动
   * @param {string} providerId
   */
  unregister(providerId) {
    this.providers.delete(providerId);
  }

  /**
   * 获取指定社区驱动
   * @param {string} providerId
   * @returns {import('./types.mjs').ICommunityProvider | null}
   */
  get(providerId) {
    return this.providers.get(providerId) || null;
  }

  /**
   * 检查指定社区驱动是否已安装并可用
   * @param {string} providerId
   * @returns {boolean}
   */
  has(providerId) {
    return this.providers.has(providerId);
  }

  /**
   * 绑定用户在某款游戏下的角色与通行证
   * @param {string} unifiedUserId - 规范化用户标识，如 "qq:123456"
   * @param {string} gameId - 游戏标识，如 "zzz", "wuwa"
   * @param {string} uid - 游戏内 UID
   * @param {string} providerId - 对应的社区驱动，如 "mihoyo", "kuro"
   * @param {any} [credentials] - 通行证凭据数据
   */
  bindUserGameRole(unifiedUserId, gameId, uid, providerId, credentials = null) {
    const key = `${unifiedUserId}:${gameId}`;
    this.userBindings.set(key, { uid, providerId, credentials });
  }

  /**
   * 获取用户在指定游戏下的绑定信息
   * @param {string} unifiedUserId
   * @param {string} gameId
   */
  getUserGameRole(unifiedUserId, gameId) {
    const key = `${unifiedUserId}:${gameId}`;
    return this.userBindings.get(key) || null;
  }

  /**
   * 列出当前所有已挂载的社区驱动清单
   */
  list() {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name
    }));
  }
}
