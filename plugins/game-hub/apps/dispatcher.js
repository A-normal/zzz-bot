/**
 * @file plugins/game-hub/apps/dispatcher.js
 * @description Game-Hub 前置调度器云崽插件：拦截所有消息并按部署人员命名空间精准分发
 */

import { InboundShaper } from "../../../lib/game-hub/inbound-shaper.mjs";
import { CommunityProviderRegistry } from "../../../lib/game-hub/provider-registry.mjs";
import { GameHubDispatcher } from "../../../lib/game-hub/dispatcher.mjs";
import { MihoyoCommunityProvider } from "../../../lib/providers/provider-mihoyo.mjs";
import fs from "node:fs";
import path from "node:path";

// 初始化并挂载全局总线单例
if (!global.__gameHubProviderRegistry) {
  const providerRegistry = new CommunityProviderRegistry();
  // 默认挂载米游社驱动
  const mihoyoProvider = new MihoyoCommunityProvider();
  providerRegistry.register(mihoyoProvider);

  global.__gameHubProviderRegistry = providerRegistry;
  global.__gameHubMihoyoProvider = mihoyoProvider;
}

if (!global.__gameHubDispatcher) {
  const dispatcher = new GameHubDispatcher({
    providerRegistry: global.__gameHubProviderRegistry
  });

  // 读取命名空间配置
  const configPath = path.resolve(process.cwd(), "plugins/game-hub/config/namespaces.yaml");
  let nsConfig = {
    zzz: { prefix: "*", aliases: ["zzz", "绝区零"], priority: 100 }
  };

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf8");
      let parsed = null;
      try {
        const yamlModule = await import("yaml");
        parsed = yamlModule.default ? yamlModule.default.parse(content) : yamlModule.parse(content);
      } catch {
        // 环境未安装 yaml 时的精密缩进解析兜底
        parsed = { namespaces: {} };
        let currentGame = null;
        let inAliases = false;
        for (const line of content.split("\n")) {
          if (!line.trim() || line.trim().startsWith("#")) continue;
          const gameMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
          if (gameMatch) {
            currentGame = gameMatch[1];
            parsed.namespaces[currentGame] = { aliases: [] };
            inAliases = false;
            continue;
          }
          if (currentGame) {
            const prefixMatch = line.match(/^    prefix:\s*['"]?([^'"]+)['"]?/);
            if (prefixMatch) {
              parsed.namespaces[currentGame].prefix = prefixMatch[1].trim();
              inAliases = false;
              continue;
            }
            const priorityMatch = line.match(/^    priority:\s*(\d+)/);
            if (priorityMatch) {
              parsed.namespaces[currentGame].priority = Number(priorityMatch[1]);
              inAliases = false;
              continue;
            }
            if (line.match(/^    aliases:\s*$/)) {
              inAliases = true;
              continue;
            }
            if (inAliases) {
              const aliasItem = line.match(/^      -\s*['"]?([^'"]+)['"]?/);
              if (aliasItem) {
                parsed.namespaces[currentGame].aliases.push(aliasItem[1].trim());
                continue;
              }
            }
          }
        }
      }

      if (parsed?.namespaces && typeof parsed.namespaces === "object") {
        nsConfig = parsed.namespaces;
      }
    } catch {
      // 保持默认配置
    }
  }

  dispatcher.loadNamespaceConfig(nsConfig);
  global.__gameHubDispatcher = dispatcher;
}

// 兼容全局 plugin 基类
const PluginBase = global.plugin || class {
  constructor(opts) { Object.assign(this, opts); }
};

export class GameHubDispatcherApp extends PluginBase {
  constructor() {
    super({
      name: "Game-Hub:分发总线",
      dsc: "多社区多游戏微内核总线与动态命名空间分发器",
      event: "message",
      priority: -1000,
      rule: [
        {
          reg: ".*",
          fnc: "dispatch",
          log: false
        }
      ]
    });
  }

  async dispatch(e) {
    if (!global.__gameHubDispatcher) return false;

    // 1. 轻量整形入站事件
    const unifiedEvent = InboundShaper.shape(e);

    // 2. 调度执行
    const result = await global.__gameHubDispatcher.dispatch(unifiedEvent);

    // 若命中游戏指令并执行完成，返回 'return' 阻断其他插件；否则放行
    if (result === "return" || result === true) {
      return "return";
    }

    return false;
  }
}

export default GameHubDispatcherApp;
