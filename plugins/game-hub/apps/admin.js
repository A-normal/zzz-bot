/**
 * @file plugins/game-hub/apps/admin.js
 * @description Game-Hub 管理与运维指令云崽插件
 */

const PluginBase = global.plugin || class {
  constructor(opts) { Object.assign(this, opts); }
};

export class GameHubAdminApp extends PluginBase {
  constructor() {
    super({
      name: "Game-Hub:管理中枢",
      dsc: "Game-Hub 总线状态与驱动信息查询",
      event: "message",
      priority: 50,
      rule: [
        {
          reg: "^#?(game-hub|gh|总线)(状态|status)$",
          fnc: "showStatus"
        },
        {
          reg: "^#?(game-hub|gh|总线)(驱动|providers)$",
          fnc: "showProviders"
        },
        {
          reg: "^#?(game-hub|gh|总线)(插件|plugins)$",
          fnc: "showPlugins"
        }
      ]
    });
  }

  async showStatus(e) {
    const dispatcher = global.__gameHubDispatcher;
    const providerReg = global.__gameHubProviderRegistry;

    const providers = providerReg ? providerReg.list() : [];
    const plugins = dispatcher ? Array.from(dispatcher.plugins.values()) : [];
    const namespaces = dispatcher ? Array.from(dispatcher.namespaces.entries()) : [];

    const lines = [
      "=== 【Game-Hub 微内核总线状态】 ===",
      `核心状态: 运行中 (Active)`,
      `已挂载驱动 (${providers.length}): ${providers.map(p => `${p.name}[${p.id}]`).join(", ") || "无"}`,
      `已接入游戏 (${plugins.length}): ${plugins.map(p => `${p.name}[${p.gameId}]`).join(", ") || "无"}`,
      "",
      "--- 部署人员命名空间路由表 ---"
    ];

    for (const [gameId, ns] of namespaces) {
      lines.push(`• [${gameId}] 触发前缀: "${ns.prefix || "(无)"}", 别名: [${ns.aliases.join(", ")}], 优先级: ${ns.priority}`);
    }

    await e.reply(lines.join("\n"), true);
    return true;
  }

  async showProviders(e) {
    const providerReg = global.__gameHubProviderRegistry;
    const providers = providerReg ? providerReg.list() : [];
    const lines = [
      "=== 【Game-Hub 社区驱动清单】 ===",
      ...providers.map((p, idx) => `${idx + 1}. ${p.name} (id: ${p.id}) [就绪]`),
      "",
      "提示: 底层社区驱动负责扫码鉴权、Token生命周期与 Takumi / 库街区 API 签名请求。"
    ];
    await e.reply(lines.join("\n"), true);
    return true;
  }

  async showPlugins(e) {
    const dispatcher = global.__gameHubDispatcher;
    const plugins = dispatcher ? Array.from(dispatcher.plugins.values()) : [];
    const lines = [
      "=== 【Game-Hub 游戏业务插件清单】 ==="
    ];

    for (const p of plugins) {
      lines.push(`• ${p.name} (${p.gameId})`);
      lines.push(`  依赖驱动: ${p.community || "无"}`);
      lines.push(`  指令数量: ${p.routes?.length || 0} 条纯指令`);
    }

    if (plugins.length === 0) {
      lines.push("当前尚未注册任何游戏业务插件。");
    }

    await e.reply(lines.join("\n"), true);
    return true;
  }
}

export default GameHubAdminApp;
