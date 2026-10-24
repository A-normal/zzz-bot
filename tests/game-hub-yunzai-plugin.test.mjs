import test from "node:test";
import assert from "node:assert/strict";

// 模拟 Yunzai 全局环境
global.plugin = class PluginMock {
  constructor(options = {}) {
    this.name = options.name || "";
    this.dsc = options.dsc || "";
    this.event = options.event || "message";
    this.priority = options.priority || 50;
    this.rule = options.rule || [];
  }
};

test("Game-Hub Yunzai Plugin Integration Suite", async (t) => {
  // 动态导入云崽插件入口
  const { apps, GameHubDispatcherApp, GameHubAdminApp } = await import("../plugins/game-hub/index.js");

  // =========================================================================
  // 1. 验证插件入口导出结构与优先级声明
  // =========================================================================
  await t.test("Verify Game-Hub exports valid Yunzai apps and proper priorities", () => {
    assert.ok(apps.dispatcher, "apps must contain dispatcher");
    assert.ok(apps.admin, "apps must contain admin");

    const dispatcherApp = new GameHubDispatcherApp();
    assert.equal(dispatcherApp.priority, -1000, "Dispatcher priority must be -1000 to intercept ahead of all game plugins");
    assert.equal(dispatcherApp.event, "message");

    const adminApp = new GameHubAdminApp();
    assert.equal(adminApp.priority, 50);
    assert.ok(adminApp.rule.length >= 3, "Admin app must have at least 3 management rules");
  });

  // =========================================================================
  // 2. 验证分发器在云崽环境中的真实拦截与派发行为
  // =========================================================================
  await t.test("Verify GameHubDispatcherApp intercepts valid command and yields unhandled messages", async () => {
    const dispatcherApp = new GameHubDispatcherApp();

    // 动态注册一个测试游戏插件到全局单例
    global.__gameHubDispatcher.registerPlugin({
      gameId: "zzz",
      name: "绝区零",
      community: "mihoyo",
      routes: [
        {
          id: "daily-note",
          tokens: ["便签", "体力"],
          action: async (ctx) => {
            await ctx.event.reply(`[ZZZ] 当前电量 240/240`, { quote: true });
            return "return";
          },
          description: "便签查询"
        }
      ]
    });

    let repliedContent = null;
    const makeEvent = (text) => ({
      user_id: 123456,
      msg: text,
      raw_message: text,
      reply: async (content) => { repliedContent = content; }
    });

    // 2.1 发送 "*便签" (命中命名空间与业务词元)
    const ret1 = await dispatcherApp.dispatch(makeEvent("*便签"));
    assert.equal(ret1, "return", "Must return 'return' to halt subsequent plugin evaluation");
    assert.equal(repliedContent, "[ZZZ] 当前电量 240/240");

    // 2.2 发送非游戏日常闲聊（如 "今晚吃什么"）
    repliedContent = null;
    const ret2 = await dispatcherApp.dispatch(makeEvent("今晚吃什么"));
    assert.equal(ret2, false, "Must return false to let other plugins handle unmanaged messages");
    assert.equal(repliedContent, null, "Should not reply to unhandled messages");
  });

  // =========================================================================
  // 3. 验证管理与运维指令面板 (GameHubAdminApp)
  // =========================================================================
  await t.test("Verify GameHubAdminApp status, providers, and plugins commands", async () => {
    const adminApp = new GameHubAdminApp();

    let repliedStatus = null;
    const mockAdminEvent = {
      user_id: 123456,
      reply: async (content) => { repliedStatus = content; }
    };

    // 3.1 测试状态面板
    await adminApp.showStatus(mockAdminEvent);
    assert.ok(repliedStatus && repliedStatus.includes("Game-Hub 微内核总线状态"), "Status output must contain header");
    assert.ok(repliedStatus.includes("米游社[mihoyo]"), "Status output must list mihoyo provider");
    assert.ok(repliedStatus.includes("绝区零[zzz]"), "Status output must list zzz game plugin");

    // 3.2 测试驱动查询
    let repliedProviders = null;
    await adminApp.showProviders({
      reply: async (content) => { repliedProviders = content; }
    });
    assert.ok(repliedProviders && repliedProviders.includes("米游社 (id: mihoyo)"), "Providers output must list active providers");

    // 3.3 测试插件清单
    let repliedPlugins = null;
    await adminApp.showPlugins({
      reply: async (content) => { repliedPlugins = content; }
    });
    assert.ok(repliedPlugins && repliedPlugins.includes("绝区零 (zzz)"), "Plugins output must list registered game manifests");
  });
});
