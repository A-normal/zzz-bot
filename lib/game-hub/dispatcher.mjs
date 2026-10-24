/**
 * @file lib/game-hub/dispatcher.mjs
 * @description 动态命名空间编译与纯指令路由微内核中枢
 */

export class GameHubDispatcher {
  /**
   * @param {Object} options
   * @param {import('./provider-registry.mjs').CommunityProviderRegistry} options.providerRegistry
   */
  constructor(options = {}) {
    this.providerRegistry = options.providerRegistry;

    /** @type {Map<string, import('./types.mjs').IGamePluginManifest>} */
    this.plugins = new Map();

    /**
     * 部署人员配置的命名空间字典
     * Key: gameId -> { prefix: string, aliases: string[], priority: number, allowBareKeywords?: boolean }
     * @type {Map<string, { prefix: string, aliases: string[], priority: number, allowBareKeywords?: boolean }>}
     */
    this.namespaces = new Map();
  }

  /**
   * 注册游戏业务插件（Manifest 纯指令契约）
   * @param {import('./types.mjs').IGamePluginManifest} manifest
   */
  registerPlugin(manifest) {
    if (!manifest || !manifest.gameId) {
      throw new Error("[GameHubDispatcher] Game manifest must have a valid gameId");
    }
    this.plugins.set(manifest.gameId, manifest);
  }

  /**
   * 卸载游戏业务插件
   * @param {string} gameId
   */
  unregisterPlugin(gameId) {
    this.plugins.delete(gameId);
  }

  /**
   * 设置部署运维人员的命名空间配置表
   * @param {Record<string, { prefix?: string, aliases?: string[], priority?: number, allow_bare_keywords?: boolean }>} config
   */
  loadNamespaceConfig(config = {}) {
    this.namespaces.clear();
    for (const [gameId, item] of Object.entries(config)) {
      this.namespaces.set(gameId, {
        prefix: item.prefix || "",
        aliases: (item.aliases || []).map(a => String(a).toLowerCase()),
        priority: typeof item.priority === "number" ? item.priority : 100,
        allowBareKeywords: Boolean(item.allow_bare_keywords)
      });
    }
  }

  /**
   * 解析输入文本所属的游戏命名空间与剥离前缀后的有效文本
   * @param {string} rawText
   * @returns {{ gameId: string, cleanText: string } | null}
   */
  resolveNamespace(rawText = "") {
    const text = String(rawText || "").trim();
    if (!text) return null;

    // 按部署人员定义的优先级降序排查
    const sortedNamespaces = Array.from(this.namespaces.entries()).sort(
      (a, b) => b[1].priority - a[1].priority
    );

    for (const [gameId, ns] of sortedNamespaces) {
      let cleanText = null;

      // 1. 显式前缀匹配（如 "*" 或 "/" 或 "%"）
      if (ns.prefix) {
        const prefixLower = ns.prefix.toLowerCase();
        if (text.toLowerCase().startsWith(prefixLower)) {
          cleanText = text.slice(ns.prefix.length).trim();
        }
      }

      // 2. 别名前缀匹配（如 "zzz", "绝区零", "鸣潮"）
      if (cleanText === null) {
        for (const alias of ns.aliases) {
          const aliasLower = alias.toLowerCase();
          if (text.toLowerCase().startsWith(aliasLower)) {
            cleanText = text.slice(alias.length).trim();
            break;
          }
        }
      }

      // 3. 复合场景：剥离前缀后，若仍紧跟别名（例如用户输入 "/鸣潮 每日" 或 "*zzz便签"）
      if (cleanText !== null) {
        for (const alias of ns.aliases) {
          const aliasLower = alias.toLowerCase();
          if (cleanText.toLowerCase().startsWith(aliasLower)) {
            cleanText = cleanText.slice(alias.length).trim();
            break;
          }
        }
        return { gameId, cleanText };
      }

      // 4. 纯关键词直发（若部署人员显式允许）
      if (ns.allowBareKeywords) {
        const plugin = this.plugins.get(gameId);
        if (plugin && plugin.routes) {
          const isTokenMatch = plugin.routes.some(r =>
            r.tokens.some(t => text.toLowerCase().startsWith(t.toLowerCase()))
          );
          if (isTokenMatch) {
            return { gameId, cleanText: text };
          }
        }
      }
    }

    return null;
  }

  /**
   * 动态调度与执行事件
   * @param {import('./types.mjs').IUnifiedEvent} event
   * @returns {Promise<boolean | 'return' | any>}
   */
  async dispatch(event) {
    if (!event || !event.rawText) return false;

    // 1. 解析命名空间
    const resolved = this.resolveNamespace(event.rawText);
    if (!resolved) {
      // 未命中任何游戏命名空间，放行给其他非游戏插件（如闲聊、查天气）
      return false;
    }

    const { gameId, cleanText } = resolved;

    // 2. 校验游戏插件安装状态
    const plugin = this.plugins.get(gameId);
    if (!plugin) {
      await event.reply(
        `[Game-Hub] 已识别游戏指令 [${gameId}]，但当前系统尚未安装该游戏插件。`,
        { quote: true }
      );
      return "return";
    }

    // 3. 纯指令词元匹配（按词元长度降序，最长匹配优先，例如“更新面板”优于“面板”）
    let matchedRoute = null;
    let matchedToken = "";
    let args = "";

    const candidateRoutes = [...(plugin.routes || [])].sort((a, b) => {
      const maxA = Math.max(...a.tokens.map(t => t.length));
      const maxB = Math.max(...b.tokens.map(t => t.length));
      return maxB - maxA;
    });

    for (const route of candidateRoutes) {
      for (const token of route.tokens) {
        const tokenLower = token.toLowerCase();
        if (cleanText.toLowerCase().startsWith(tokenLower)) {
          // 匹配到了指令头
          const remainder = cleanText.slice(token.length).trim();
          // 若路由不支持参数但后面带有非空白字符，则跳过
          if (!route.hasArgs && remainder.length > 0) {
            continue;
          }
          matchedRoute = route;
          matchedToken = token;
          args = remainder;
          break;
        }
      }
      if (matchedRoute) break;
    }

    if (!matchedRoute) {
      // 命中了游戏前缀，但不是合法的指令词元
      await event.reply(
        `[Game-Hub] 游戏 [${plugin.name}] 不存在此指令。发送对应帮助可查看完整指令清单。`,
        { quote: true }
      );
      return "return";
    }

    // 4. 社区底层驱动就绪状态校验
    const requiredCommunity = plugin.community;
    let provider = null;
    if (requiredCommunity && this.providerRegistry) {
      if (!this.providerRegistry.has(requiredCommunity)) {
        await event.reply(
          `[Game-Hub] 游戏 [${plugin.name}] 依赖底层社区驱动 [${requiredCommunity}]，但系统尚未安装该驱动，无法请求数据。`,
          { quote: true }
        );
        return "return";
      }
      provider = this.providerRegistry.get(requiredCommunity);
    }

    // 5. 组装隔离上下文并注入游戏业务处理器
    const userRole = this.providerRegistry
      ? this.providerRegistry.getUserGameRole(event.unifiedUserId, gameId)
      : null;

    /** @type {import('./types.mjs').IGameContext} */
    const context = {
      event,
      gameId,
      routeId: matchedRoute.id,
      args,
      uid: userRole?.uid || null,
      credentials: userRole?.credentials || null,
      client: provider?.client || null
    };

    // 6. 执行业务派发
    try {
      const result = await matchedRoute.action(context);
      return result !== undefined ? result : "return";
    } catch (err) {
      const errTip = `[Game-Hub] 执行指令 [${matchedToken}] 出错: ${err.message || err}`;
      await event.reply(errTip, { quote: true });
      return "return";
    }
  }
}
