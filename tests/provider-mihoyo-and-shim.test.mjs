import test from "node:test";
import assert from "node:assert/strict";

import { MihoyoCommunityProvider } from "../lib/providers/provider-mihoyo.mjs";
import { CommunityProviderRegistry } from "../lib/game-hub/provider-registry.mjs";
import NoteUserShim from "../lib/game-hub/shim/note-user.mjs";
import MysApiShim from "../lib/game-hub/shim/mys-api.mjs";
import UserShim from "../lib/game-hub/shim/user.mjs";

test("Provider-Mihoyo and Genshin Model Shims Compatibility Suite", async (t) => {
  const mihoyoProvider = new MihoyoCommunityProvider();

  // =========================================================================
  // 1. 测试 Mihoyo 底层驱动签名与请求头生成
  // =========================================================================
  await t.test("MihoyoCommunityProvider DS generation and header assembly", () => {
    // 1.1 DS1 生成测试
    const ds1 = mihoyoProvider.getDs1("uid=17708598", "", "prod_gf_cn");
    assert.ok(typeof ds1 === "string", "DS1 must be a string");
    const parts1 = ds1.split(",");
    assert.equal(parts1.length, 3, "DS1 must consist of t, r, and md5 hash");
    assert.equal(parts1[2].length, 32, "DS1 hash must be 32-char hex md5");

    // 1.2 DS2 生成测试
    const ds2 = mihoyoProvider.getDs2();
    assert.ok(typeof ds2 === "string", "DS2 must be a string");
    const parts2 = ds2.split(",");
    assert.equal(parts2.length, 3, "DS2 must consist of t, r, and md5 hash");

    // 1.3 请求头装配测试
    const headers = mihoyoProvider.buildHeaders({
      query: "uid=17708598",
      cookies: { ltuid: "10001", ltoken: "test_token" },
      deviceId: "test-device-uuid-1234",
      deviceFp: "38d7f8a9b0c1"
    });
    assert.equal(headers["x-rpc-app_version"], "2.71.1");
    assert.equal(headers["x-rpc-client_type"], "5");
    assert.equal(headers["x-rpc-device_id"], "test-device-uuid-1234");
    assert.equal(headers["x-rpc-device_fp"], "38d7f8a9b0c1");
    assert.ok(headers.DS && headers.DS.length > 20, "DS header must be present");
    assert.ok(headers.Cookie.includes("ltuid=10001"), "Cookie must contain ltuid");
    assert.ok(headers.Cookie.includes("ltoken=test_token"), "Cookie must contain ltoken");
  });

  // =========================================================================
  // 2. 测试 NoteUser 兼容垫片 (替代 genshin/model/mys/NoteUser.js)
  // =========================================================================
  await t.test("NoteUserShim delegates to Game-Hub identity store without Genshin dependencies", async () => {
    const registry = new CommunityProviderRegistry();
    registry.bindUserGameRole("qq-napcat:123456", "zzz", "17708598", "mihoyo", {
      cookie: "ltuid=123456; ltoken=abc",
      device_id: "dev-999"
    });
    global.__gameHubProviderRegistry = registry;

    // 模拟 ZZZ-Plugin 中的调用模式：const User = await NoteUser.create(e)
    const mockEvent = { user_id: 123456, isZZZ: true };
    const noteUser = await NoteUserShim.create(mockEvent);

    assert.equal(noteUser.getUid("zzz"), "17708598", "Must resolve ZZZ UID from Game-Hub registry");
    const ckList = noteUser.getCkUidList("zzz");
    assert.equal(ckList.length, 1);
    assert.equal(ckList[0].uid, "17708598");
  });

  // =========================================================================
  // 3. 测试 User 兼容垫片 (替代 genshin/model/user.js)
  // =========================================================================
  await t.test("UserShim provides getCk() and user() for ZZZ-Plugin common.js", async () => {
    const mockEvent = { user_id: 123456 };
    const userShim = new UserShim(mockEvent);

    // 3.1 测试 getCk()
    const ckResult = userShim.getCk();
    assert.ok(ckResult.default, "Must return default account");
    assert.equal(ckResult.default.uid, "17708598");
    assert.ok(ckResult.default.ck.includes("ltuid=123456"));
    assert.equal(ckResult.default.device_id, "dev-999");

    // 3.2 测试 user() 备用方法
    const mysUser = await userShim.user();
    assert.equal(mysUser.getCkUid("zzz"), "17708598");
    const zzzUser = mysUser.getMysUser("zzz");
    assert.equal(zzzUser.device, "dev-999");
  });

  // =========================================================================
  // 4. 测试 MysApi 兼容垫片 (替代 genshin/model/mys/mysApi.js)
  // =========================================================================
  await t.test("MysApiShim provides server calculation and header generation", () => {
    global.__gameHubMihoyoProvider = mihoyoProvider;

    // 模拟 MysZZZApi 继承 MysApi 的行为
    const api = new MysApiShim("17708598", "ltuid=123456", {}, true);
    assert.equal(api.server, "prod_gf_cn", "Must determine server as prod_gf_cn for CN UID");
    assert.ok(api.device && api.device.startsWith("Hub-"), "Must have default hub device id");

    const headers = api.getHeaders("role_id=17708598&server=prod_gf_cn");
    assert.ok(headers.DS, "Must contain computed DS header");
    assert.equal(headers.Cookie, "ltuid=123456");

    // 测试海外服 UID 判定 (海外服 UID 为 10 位数，前两位为区域码，如 10xxxxxxxx 为美服)
    const osApi = new MysApiShim("1000012345", "cookie=abc", {}, true);
    assert.equal(osApi.server, "prod_gf_us", "Must determine server as prod_gf_us for 10-digit UID 10xxxxxxxx");
  });
});
