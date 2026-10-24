import assert from 'node:assert/strict';

// Load Yunzai runtime globals inside container
const YunzaiPlugin = (await import('/root/Yunzai/lib/plugins/plugin.js')).default;
global.plugin = YunzaiPlugin;
global.logger = {
  info: console.log,
  mark: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {}
};

console.log('=== [1] Verifying miao-plugin/apps/profile.js stub in container ===');
const miaoProfile = (await import('/root/Yunzai/plugins/miao-plugin/apps/profile.js')).default;
const ProfileClass = miaoProfile.v3App();
const profileInst = new ProfileClass();
console.log('  -> Miao profile rules count:', profileInst.rule.length);
assert.equal(profileInst.rule.length, 0, 'Profile stub must have 0 rules');
console.log('  ✔ Confirmed: Miao profile has 0 rules (no greedy regexes like ^#.+换.+$)');

console.log('=== [2] Verifying zzzShortcuts Router in container ===');
const { zzzShortcuts } = await import('/root/Yunzai/plugins/example/zzzShortcuts.js');
const shortcut = new zzzShortcuts();

const simulate = async (input, raw_message = null) => {
  let repliedMsg = null;
  const e = {
    msg: input,
    raw_message: raw_message || input,
    reply: async (msg) => { repliedMsg = msg; }
  };
  const res = await shortcut.accept(e);
  return { msg: e.msg, game: e.game, res, repliedMsg };
};

// Test 兑换码 shortcuts
const t1 = await simulate('/兑换码');
assert.equal(t1.msg, '#绝区零兑换码');
assert.equal(t1.game, 'zzz');
assert.equal(t1.res, false);
assert.equal(t1.repliedMsg, null);
console.log('  ✔ [/兑换码] -> #绝区零兑换码 (game: zzz, not rejected as invalid slash)');

const t2 = await simulate('%兑换码');
assert.equal(t2.msg, '#绝区零兑换码');
assert.equal(t2.game, 'zzz');
console.log('  ✔ [%兑换码] -> #绝区零兑换码 (game: zzz)');

const t3 = await simulate('#兑换码');
assert.equal(t3.msg, '#绝区零兑换码');
assert.equal(t3.game, 'zzz');
console.log('  ✔ [#兑换码] -> #绝区零兑换码 (game: zzz)');

const t4 = await simulate('/code');
assert.equal(t4.msg, '#绝区零兑换码');
assert.equal(t4.game, 'zzz');
console.log('  ✔ [/code] -> #绝区零兑换码 (game: zzz)');

const t5 = await simulate('兑换码');
assert.equal(t5.msg, '#绝区零兑换码');
assert.equal(t5.game, 'zzz');
console.log('  ✔ [兑换码] -> #绝区零兑换码 (game: zzz)');

// Test 日历 / 月报
const t6 = await simulate('/日历');
assert.equal(t6.msg, '#绝区零日历');
assert.equal(t6.game, 'zzz');
console.log('  ✔ [/日历] -> #绝区零日历 (game: zzz)');

const t7 = await simulate('/月报');
assert.equal(t7.msg, '#绝区零月报');
assert.equal(t7.game, 'zzz');
console.log('  ✔ [/月报] -> #绝区零月报 (game: zzz)');

console.log('=== [3] Verifying ZZZ-Plugin Code Rule Matching in container ===');
const { Code } = await import('/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/code.js');
const codeInst = new Code();
const rule = codeInst.rule[0];
console.log('  -> ZZZ Code rule:', rule.reg);

const matchedCode = new RegExp(rule.reg).test('#绝区零兑换码');
assert.equal(matchedCode, true, '#绝区零兑换码 must match ZZZ Code rule');
console.log('  ✔ Confirmed: #绝区零兑换码 matches [ZZZ-Plugin]Code cleanly');

console.log('=== ALL ONLINE VERIFICATIONS PASSED ===');
process.exit(0);
