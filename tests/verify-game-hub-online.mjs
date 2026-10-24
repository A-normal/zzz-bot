import assert from "node:assert/strict";

// 注入 Yunzai 运行期全局变量
const YunzaiPlugin = (await import("/root/Yunzai/lib/plugins/plugin.js")).default;
global.plugin = YunzaiPlugin;
global.logger = {
  info: console.log,
  mark: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {}
};

console.log("=== [1] 验证 Game-Hub 云崽插件加载与全局总线实例化 ===");
const { apps, GameHubDispatcherApp, GameHubAdminApp } = await import("/root/Yunzai/plugins/game-hub/index.js");
assert.ok(apps.dispatcher, "apps.dispatcher must be exported");
assert.ok(apps.admin, "apps.admin must be exported");

const dispatcherApp = new GameHubDispatcherApp();
assert.equal(dispatcherApp.priority, -1000, "Dispatcher priority must be -1000");

const adminApp = new GameHubAdminApp();
assert.equal(adminApp.priority, 50, "Admin app priority must be 50");
console.log("  ✔ Game-Hub 插件及其 Apps 在容器内成功实例化！");

console.log("=== [2] 验证全局注册表与米游社驱动装配 ===");
assert.ok(global.__gameHubProviderRegistry, "global.__gameHubProviderRegistry must be initialized");
assert.ok(global.__gameHubDispatcher, "global.__gameHubDispatcher must be initialized");
assert.ok(global.__gameHubMihoyoProvider, "global.__gameHubMihoyoProvider must be initialized");

const providers = global.__gameHubProviderRegistry.list();
console.log("  -> 已挂载驱动:", providers.map(p => `${p.name}[${p.id}]`).join(", "));
assert.equal(providers.length, 1);
assert.equal(providers[0].id, "mihoyo");
console.log("  ✔ 米游社底层驱动 SPI 在容器内就绪！");

console.log("=== [3] 验证去原神兼容垫片 (NoteUser / MysApi / User) ===");
const NoteUserShim = (await import("/root/Yunzai/lib/game-hub/shim/note-user.mjs")).default;
const UserShim = (await import("/root/Yunzai/lib/game-hub/shim/user.mjs")).default;
const MysApiShim = (await import("/root/Yunzai/lib/game-hub/shim/mys-api.mjs")).default;

// 绑定测试数据
global.__gameHubProviderRegistry.bindUserGameRole("qq-napcat:998877", "zzz", "17708598", "mihoyo", {
  ck: "ltuid=998877; ltoken=mock_token_online",
  device_id: "dev-online-test"
});

const mockEvent = { user_id: 998877, isZZZ: true };
const userInst = await NoteUserShim.create(mockEvent);
const uid = userInst.getUid("zzz");
assert.equal(uid, "17708598", "NoteUserShim must resolve UID from Game-Hub");

const userShimInst = new UserShim(mockEvent);
const ckData = userShimInst.getCk();
assert.equal(ckData.default.uid, "17708598");
assert.equal(ckData.default.device_id, "dev-online-test");

const apiInst = new MysApiShim("17708598", "ltuid=998877", {}, true);
const headers = apiInst.getHeaders();
assert.ok(headers.DS && headers.DS.length > 20, "MysApiShim must generate valid DS signature");
console.log("  ✔ 所有去原神兼容垫片在容器内验证 100% 通过！");

console.log("=== [4] 验证管理指令 #game-hub状态 ===");
let statusReply = null;
await adminApp.showStatus({
  user_id: 998877,
  reply: async (msg) => { statusReply = msg; }
});
console.log("  -> 状态输出演示:\n" + statusReply);
assert.ok(statusReply.includes("Game-Hub 微内核总线状态"));
assert.ok(statusReply.includes("米游社[mihoyo]"));
console.log("  ✔ 管理指令在容器内执行成功！");

console.log("=== 容器内全链路在线验证全部通过 (ALL CHECKS PASSED) ===");
process.exit(0);
