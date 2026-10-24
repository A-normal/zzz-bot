import test from "node:test";
import assert from "node:assert/strict";

import { InboundShaper } from "../lib/game-hub/inbound-shaper.mjs";
import { CommunityProviderRegistry } from "../lib/game-hub/provider-registry.mjs";
import { GameHubDispatcher } from "../lib/game-hub/dispatcher.mjs";

test("Game-Hub End-to-End Prototype Suite", async (t) => {
  // =========================================================================
  // 1. 测试西向渠道输入事件整形器 (Inbound Shaper)
  // =========================================================================
  await t.test("InboundShaper normalizes events across QQ, Official QQBot, and Telegram", () => {
    // 1.1 NapCat / OneBot QQ 消息
    const qqRaw = {
      user_id: 123456789,
      group_id: 987654321,
      raw_message: "[CQ:at,qq=999888] *便签",
      atBot: true,
      reply: async () => {}
    };
    const qqEvent = InboundShaper.shape(qqRaw);
    assert.equal(qqEvent.channel, "qq-napcat");
    assert.equal(qqEvent.unifiedUserId, "qq-napcat:123456789");
    assert.equal(qqEvent.groupId, "qq-napcat_group:987654321");
    assert.equal(qqEvent.isAtBot, true);
    assert.equal(qqEvent.rawText, "*便签");

    // 1.2 Telegram 消息（补齐无 at 段缺陷，自动识别 @Bot 并剔除）
    const tgRaw = {
      adapter: { name: "Telegram" },
      user_id: 797397241,
      msg: "/便签 @my_test_bot",
      reply: async () => {}
    };
    const tgEvent = InboundShaper.shape(tgRaw, { botUsername: "my_test_bot" });
    assert.equal(tgEvent.channel, "telegram");
    assert.equal(tgEvent.unifiedUserId, "telegram:797397241");
    assert.equal(tgEvent.isAtBot, true);
    assert.equal(tgEvent.rawText, "/便签");

    // 1.3 官方开放平台 QQBot (43位哈希)
    const officialRaw = {
      adapter: { name: "QQBot" },
      user_id: "1904107636:F9F6331F761AE56AC1F49A8C197D1AFA",
      raw_message: "<@!12345> %面板 简",
      reply: async () => {}
    };
    const offEvent = InboundShaper.shape(officialRaw);
    assert.equal(offEvent.channel, "qq-official");
    assert.equal(offEvent.unifiedUserId, "qq-official:1904107636:F9F6331F761AE56AC1F49A8C197D1AFA");
    assert.equal(offEvent.rawText, "%面板 简");
  });

  // =========================================================================
  // 2. 模拟构建纯业务游戏插件 (Game Plugin Manifests)
  // =========================================================================
  // 绝区零纯指令插件（完全不包含任何前缀符号！）
  const mockZzzPlugin = {
    gameId: "zzz",
    name: "绝区零",
    community: "mihoyo",
    routes: [
      {
        id: "daily-note",
        tokens: ["便签", "体力", "每日", "note"],
        action: async (ctx) => {
          return `[ZZZ] UID:${ctx.uid || "未绑定"} 电量: 240/240`;
        },
        description: "查询绝区零体力与便签"
      },
      {
        id: "panel",
        tokens: ["面板", "更新面板"],
        hasArgs: true,
        action: async (ctx) => {
          return `[ZZZ] UID:${ctx.uid || "未绑定"} 角色:${ctx.args || "全量"} 面板查询成功`;
        },
        description: "查询或刷新绝区零角色面板"
      },
      {
        id: "code",
        tokens: ["兑换码", "code"],
        action: async () => {
          return `[ZZZ] 最新前瞻兑换码: ZZZFREEFILM2026`;
        },
        description: "查询绝区零兑换码"
      }
    ]
  };

  // 鸣潮纯指令插件（依赖 kuro 社区驱动）
  const mockWuwaPlugin = {
    gameId: "wuwa",
    name: "鸣潮",
    community: "kuro",
    routes: [
      {
        id: "daily-note",
        tokens: ["每日", "便签", "体力"],
        action: async (ctx) => {
          return `[鸣潮] UID:${ctx.uid || "未绑定"} 结晶波片: 240/240`;
        },
        description: "查询鸣潮结晶波片"
      }
    ]
  };

  // 模拟米游社底层驱动 SPI
  const mockMihoyoProvider = {
    id: "mihoyo",
    name: "米游社",
    auth: {
      createQrCode: async () => ({ qrUrl: "https://mock.mihoyo.com/qr", ticket: "mock-ticket" }),
      pollQrStatus: async () => ({ status: "confirmed", credentials: { token: "mock-token" } })
    },
    roles: {
      fetchGameRoles: async () => [{ gameId: "zzz", uid: "17708598", region: "prod_gf_cn", nickname: "哲" }]
    },
    client: {
      request: async (opts) => ({ code: 0, data: { ok: true } })
    }
  };

  // =========================================================================
  // 3. 场景 A：部署人员 A 配置绝区零前缀为 "*"
  // =========================================================================
  await t.test("Deployer A scenario: prefix is '*', pure zzz commands match cleanly", async () => {
    const providerRegistry = new CommunityProviderRegistry();
    providerRegistry.register(mockMihoyoProvider);
    providerRegistry.bindUserGameRole("qq-napcat:1001", "zzz", "17708598", "mihoyo");

    const dispatcher = new GameHubDispatcher({ providerRegistry });
    dispatcher.registerPlugin(mockZzzPlugin);

    // 部署人员 A 的专属前缀配置
    dispatcher.loadNamespaceConfig({
      zzz: { prefix: "*", aliases: ["zzz", "绝区零"], priority: 100 }
    });

    let replied = null;
    const makeEvent = (text) => InboundShaper.shape({
      user_id: 1001,
      raw_message: text,
      reply: async (msg) => { replied = msg; }
    });

    // 3.1 测试 "*便签"
    const r1 = await dispatcher.dispatch(makeEvent("*便签"));
    assert.equal(r1, "[ZZZ] UID:17708598 电量: 240/240");

    // 3.2 测试 "*面板 简"
    const r2 = await dispatcher.dispatch(makeEvent("*面板 简"));
    assert.equal(r2, "[ZZZ] UID:17708598 角色:简 面板查询成功");

    // 3.3 测试 "*兑换码"（彻底摆脱喵喵面板抢占）
    const r3 = await dispatcher.dispatch(makeEvent("*兑换码"));
    assert.equal(r3, "[ZZZ] 最新前瞻兑换码: ZZZFREEFILM2026");

    // 3.4 测试别名触发 "zzz便签"
    const r4 = await dispatcher.dispatch(makeEvent("zzz便签"));
    assert.equal(r4, "[ZZZ] UID:17708598 电量: 240/240");

    // 3.5 纯无关消息（如 "今天天气真好"） -> 不命中，返回 false 放行给聊天插件
    const r5 = await dispatcher.dispatch(makeEvent("今天天气真好"));
    assert.equal(r5, false);

    // 3.6 输入了前缀但指令不存在 -> 给出友好提示
    replied = null;
    const r6 = await dispatcher.dispatch(makeEvent("*不存在的指令xyz"));
    assert.equal(r6, "return");
    assert.ok(replied && replied.includes("不存在此指令"));
  });

  // =========================================================================
  // 4. 场景 B：部署人员 B 配置绝区零前缀为 "/"（同一插件源码 0 修改）
  // =========================================================================
  await t.test("Deployer B scenario: prefix is '/', exactly same plugin code", async () => {
    const providerRegistry = new CommunityProviderRegistry();
    providerRegistry.register(mockMihoyoProvider);
    providerRegistry.bindUserGameRole("telegram:2002", "zzz", "18889999", "mihoyo");

    const dispatcher = new GameHubDispatcher({ providerRegistry });
    // 直接复用同一个 mockZzzPlugin！不需要改动插件任何一行代码！
    dispatcher.registerPlugin(mockZzzPlugin);

    // 部署人员 B 将前缀配置为 "/"
    dispatcher.loadNamespaceConfig({
      zzz: { prefix: "/", aliases: ["zzz"], priority: 100 }
    });

    const makeTgEvent = (text) => InboundShaper.shape({
      adapter: { name: "Telegram" },
      user_id: 2002,
      msg: text,
      reply: async () => {}
    });

    // 4.1 在部署员 B 模式下，"/便签" 成功触发
    const r1 = await dispatcher.dispatch(makeTgEvent("/便签"));
    assert.equal(r1, "[ZZZ] UID:18889999 电量: 240/240");

    // 4.2 而在部署员 B 模式下，"*便签" 视为普通消息放行，不会触发绝区零
    const r2 = await dispatcher.dispatch(makeTgEvent("*便签"));
    assert.equal(r2, false);
  });

  // =========================================================================
  // 5. 场景 C：多社区扩展与缺少驱动熔断提示 (Pluggable Community SPI)
  // =========================================================================
  await t.test("Pluggable Community SPI: Missing Kuro driver gives friendly message, mounting succeeds", async () => {
    const providerRegistry = new CommunityProviderRegistry();
    // 此时仅安装了米游社驱动，没有安装库洛驱动
    providerRegistry.register(mockMihoyoProvider);

    const dispatcher = new GameHubDispatcher({ providerRegistry });
    dispatcher.registerPlugin(mockZzzPlugin);
    dispatcher.registerPlugin(mockWuwaPlugin); // 安装了鸣潮游戏插件

    dispatcher.loadNamespaceConfig({
      zzz: { prefix: "*", priority: 100 },
      wuwa: { prefix: "/", aliases: ["鸣潮", "wuwa"], priority: 90 }
    });

    let replied = null;
    const makeEvent = (text) => InboundShaper.shape({
      user_id: 3003,
      raw_message: text,
      reply: async (msg) => { replied = msg; }
    });

    // 5.1 用户发送 "/鸣潮 每日" -> 识别了鸣潮，但缺少 provider-kuro 驱动
    replied = null;
    const r1 = await dispatcher.dispatch(makeEvent("/鸣潮 每日"));
    assert.equal(r1, "return");
    assert.ok(
      replied && replied.includes("依赖底层社区驱动 [kuro]，但系统尚未安装该驱动"),
      `Expected missing driver message, got: ${replied}`
    );

    // 5.2 现在管理员热拔插安装了 provider-kuro 驱动
    const mockKuroProvider = {
      id: "kuro",
      name: "库街区",
      client: { request: async () => ({}) }
    };
    providerRegistry.register(mockKuroProvider);
    providerRegistry.bindUserGameRole("qq-napcat:3003", "wuwa", "10998877", "kuro");

    // 5.3 再次发送 -> 成功直接派发执行！
    const r2 = await dispatcher.dispatch(makeEvent("/鸣潮 每日"));
    assert.equal(r2, "[鸣潮] UID:10998877 结晶波片: 240/240");
  });
});
