import test from "node:test";
import assert from "node:assert/strict";

import NoteUserShim from "../lib/game-hub/shim/note-user.mjs";
import MysApiShim from "../lib/game-hub/shim/mys-api.mjs";
import UserShim from "../lib/game-hub/shim/user.mjs";
import { CommunityProviderRegistry } from "../lib/game-hub/provider-registry.mjs";
import { MihoyoCommunityProvider } from "../lib/providers/provider-mihoyo.mjs";

test("Zero-Genshin Integration Test: ZZZ-Plugin Core Patterns running over Game-Hub Shims", async (t) => {
  // 1. 初始化 Game-Hub 底层注册表与米游社驱动
  const providerRegistry = new CommunityProviderRegistry();
  const mihoyoProvider = new MihoyoCommunityProvider();
  providerRegistry.register(mihoyoProvider);

  // 绑定测试用户的绝区零凭据与 UID
  const testUserId = 888999111;
  providerRegistry.bindUserGameRole(`qq-napcat:${testUserId}`, "zzz", "17708598", "mihoyo", {
    ck: "ltuid=888999111; ltoken=fake_ltoken_xyz",
    ltuid: "888999111",
    device_id: "dev-mock-888"
  });
  global.__gameHubProviderRegistry = providerRegistry;
  global.__gameHubMihoyoProvider = mihoyoProvider;

  // =========================================================================
  // 2. 模拟 ZZZPlugin.prototype.getUID() 的行为（参考 plugin.js:15-32）
  // =========================================================================
  await t.test("Simulate ZZZPlugin.prototype.getUID() using NoteUserShim", async () => {
    // 模拟真实的 Event 上下文
    const mockEvent = {
      user_id: testUserId,
      msg: "#绝区零便签",
      isZZZ: true
    };

    // 核心调用代码：完全与 ZZZ-Plugin 源码第 24-25 行一致
    const User = await NoteUserShim.create(mockEvent);
    const uid = User?.getUid("zzz");

    assert.equal(uid, "17708598", "Must resolve UID 17708598 successfully");
  });

  // =========================================================================
  // 3. 模拟 ZZZ-Plugin common.js:getCk() 的行为（参考 common.js:15-45）
  // =========================================================================
  await t.test("Simulate ZZZ-Plugin getCk() using UserShim", async () => {
    const mockEvent = {
      user_id: testUserId,
      isZZZ: true
    };

    // 核心调用代码：完全与 ZZZ-Plugin common.js:17-27 行一致
    const user = new UserShim(mockEvent);
    const ck = user.getCk();

    assert.ok(ck && ck.default, "Must return valid default cookie object");
    assert.equal(ck.default.uid, "17708598");
    assert.ok(ck.default.ck.includes("fake_ltoken_xyz"));
    assert.equal(ck.default.device_id, "dev-mock-888");
  });

  // =========================================================================
  // 4. 模拟 MysZZZApi 继承并生成 Takumi 请求签名的行为（参考 mysapi.js:10-50）
  // =========================================================================
  await t.test("Simulate MysZZZApi extending MysApiShim", () => {
    // 构造子类，模拟 ZZZ-Plugin 的 MysZZZApi
    class MockMysZZZApi extends MysApiShim {
      constructor(uid, cookie, option) {
        super(uid, cookie, option, true);
      }
    }

    const zzzApi = new MockMysZZZApi("17708598", "ltuid=888999111; ltoken=fake_ltoken_xyz");
    assert.equal(zzzApi.server, "prod_gf_cn");

    const headers = zzzApi.getHeaders("role_id=17708598&server=prod_gf_cn");
    assert.ok(headers.DS && headers.DS.split(",").length === 3, "DS signature must be correctly generated");
    assert.equal(headers["x-rpc-app_version"], "2.71.1");
    assert.ok(headers.Cookie.includes("fake_ltoken_xyz"));
  });
});
