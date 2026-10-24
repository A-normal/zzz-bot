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

// 1. Import runtime instances
const { zzzShortcuts } = await import('/root/Yunzai/plugins/example/zzzShortcuts.js');
const { Zenkov } = await import('/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/zenkov.js');

const shortcut = new zzzShortcuts();
const zenkovApp = new Zenkov();

console.log('=== [1] Verifying zzzShortcuts Router for Bagel & Maze Commands ===');

const simulateShortcut = async (input, raw_message = null) => {
  let repliedMsg = null;
  const e = {
    msg: input,
    raw_message: raw_message || input,
    reply: async (msg) => { repliedMsg = msg; }
  };
  const res = await shortcut.accept(e);
  return { msg: e.msg, res, repliedMsg };
};

// Test overview shortcuts
const t1 = await simulateShortcut('/贝果');
assert.equal(t1.msg, '#绝区零贝果');
assert.equal(t1.res, false);
console.log('  ✔ [/贝果] -> #绝区零贝果');

const t2 = await simulateShortcut('/贝果计划');
assert.equal(t2.msg, '#绝区零贝果');
assert.equal(t2.res, false);
console.log('  ✔ [/贝果计划] -> #绝区零贝果');

const t3 = await simulateShortcut('/更新贝果');
assert.equal(t3.msg, '#绝区零贝果');
assert.equal(t3.res, false);
console.log('  ✔ [/更新贝果] -> #绝区零贝果');

const t4 = await simulateShortcut('/刷新贝果计划');
assert.equal(t4.msg, '#绝区零贝果');
assert.equal(t4.res, false);
console.log('  ✔ [/刷新贝果计划] -> #绝区零贝果');

const t4_percent = await simulateShortcut('%贝果');
assert.equal(t4_percent.msg, '#绝区零贝果');
assert.equal(t4_percent.res, false);
console.log('  ✔ [%贝果] -> #绝区零贝果');

// Test detail shortcuts
const t5 = await simulateShortcut('/贝果战绩');
assert.equal(t5.msg, '#绝区零贝果战绩');
assert.equal(t5.res, false);
console.log('  ✔ [/贝果战绩] -> #绝区零贝果战绩');

const t6 = await simulateShortcut('/更新贝果战绩');
assert.equal(t6.msg, '#绝区零贝果战绩');
assert.equal(t6.res, false);
console.log('  ✔ [/更新贝果战绩] -> #绝区零贝果战绩');

const t7 = await simulateShortcut('贝果计划战绩');
assert.equal(t7.msg, '#绝区零贝果战绩');
assert.equal(t7.res, false);
console.log('  ✔ [贝果计划战绩] -> #绝区零贝果战绩');

const t8 = await simulateShortcut('/迷宫战绩');
assert.equal(t8.msg, '#绝区零贝果战绩');
assert.equal(t8.res, false);
console.log('  ✔ [/迷宫战绩] -> #绝区零贝果战绩');

// Test unknown slash command interception
const t9 = await simulateShortcut('/未知测试指令');
assert.equal(t9.res, 'return');
assert.ok(t9.repliedMsg.includes('没有快捷指令“/未知测试指令”'));
console.log('  ✔ [/未知测试指令] -> 安全拦截报错，不穿透');

console.log('\n=== [2] Verifying Zenkov App Rule Dispatching ===');
console.log('Zenkov rules count:', zenkovApp.rule.length);

const matchZenkovRule = (msg) => {
  for (const r of zenkovApp.rule) {
    const reg = new RegExp(r.reg, 'i');
    if (reg.test(msg)) {
      return r.fnc;
    }
  }
  return null;
};

// Dispatch checks for overview
const overviewCommands = [
  '#绝区零贝果',
  '#zzz贝果',
  '#zzz贝果计划',
  '#zzz更新贝果',
  '#绝区零刷新贝果计划',
  '#zzz迷宫',
  '#zzz迷宫诡域',
  '#zzz搜打撤',
  '#zzz绝科夫',
  '%zzz贝果'
];

for (const cmd of overviewCommands) {
  const fnc = matchZenkovRule(cmd);
  assert.equal(fnc, 'zenkov', `Expected ${cmd} to match fnc: zenkov, got: ${fnc}`);
  console.log(`  ✔ [${cmd}] matched fnc: zenkov`);
}

// Dispatch checks for detail
const detailCommands = [
  '#绝区零贝果战绩',
  '#zzz贝果战绩',
  '#zzz贝果计划战绩',
  '#zzz更新贝果战绩',
  '#绝区零刷新贝果计划战绩',
  '#zzz贝果详情',
  '#zzz贝果记录',
  '#zzz迷宫战绩',
  '#zzz搜打撤战绩',
  '%zzz更新贝果战绩'
];

for (const cmd of detailCommands) {
  const fnc = matchZenkovRule(cmd);
  assert.equal(fnc, 'zenkovDetail', `Expected ${cmd} to match fnc: zenkovDetail, got: ${fnc}`);
  console.log(`  ✔ [${cmd}] matched fnc: zenkovDetail`);
}

console.log('\n=== [3] Verifying End-to-End Pipeline Execution with Mock Event ===');
// Mock event invoking zenkovDetail flow
let replyCalled = false;
let replyContent = null;

const mockEvent = {
  msg: '#绝区零贝果战绩',
  reply: async (msg) => {
    replyCalled = true;
    replyContent = msg;
  }
};

zenkovApp.e = mockEvent;
zenkovApp.getAPI = async () => ({
  api: {
    getFinalData: async (type) => {
      console.log(`  -> API getFinalData called with type: ${type}`);
      assert.equal(type, 'zzzZenkovDetail');
      // Return null to test fallback handling
      return null;
    }
  },
  deviceFp: 'mock_device_fp'
});
zenkovApp.getPlayerInfo = async () => true;

await zenkovApp.zenkovDetail();
assert.equal(replyCalled, true);
assert.equal(replyContent, '暂无迷宫诡域/贝果计划详细战绩数据');
console.log('  ✔ zenkovDetail() executed gracefully with prompt: ' + replyContent);

console.log('\n>>> All Online Verification Checks Passed Successfully! <<<');
process.exit(0);
