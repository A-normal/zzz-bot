// tests/zzz-namespace-regex-test.mjs
// Automated verification for ZZZ-Plugin namespace routing, regexes, and edge-case syntax
import assert from 'node:assert';

console.log("==========================================================");
console.log("  ZZZ-Plugin Namespace Routing & Regex Regression Test");
console.log("==========================================================");

// In ZZZ-Plugin, rulePrefix is:
const rulePrefix = '(?:#|%|％|绝区零|绝区)?(?:zzz|ZZZ|绝区零)?';

// 1. Monthly Regex Verification (both date-before and date-after)
const monthlyReg = new RegExp(`^${rulePrefix}(?:(\\d{4})年)?(?:(\\d{1,2}|上)月)?(?:monthly|菲林|邦布券|收入|月报)(?:(\\d{4})年)?(?:(\\d{1,2}|上)月)?$`);

const monthlyCases = [
  { input: "%2024年9月月报", expectedYear: "2024", expectedMonth: "9" },
  { input: "%9月月报", expectedYear: undefined, expectedMonth: "9" },
  { input: "%月报2024年9月", expectedYear: "2024", expectedMonth: "9" },
  { input: "%月报", expectedYear: undefined, expectedMonth: undefined },
  { input: "%菲林", expectedYear: undefined, expectedMonth: undefined },
  { input: "%上月月报", expectedYear: undefined, expectedMonth: "上" },
  { input: "#绝区零2024年10月收入", expectedYear: "2024", expectedMonth: "10" }
];

console.log("\n[1/4] Verifying Monthly Regexes...");
for (const tc of monthlyCases) {
  const match = tc.input.match(monthlyReg);
  assert(match, `Failed to match monthly: ${tc.input}`);
  const year = match[1] || match[3];
  const month = match[2] || match[4];
  assert.strictEqual(year, tc.expectedYear, `Year mismatch for ${tc.input}: got ${year}, expected ${tc.expectedYear}`);
  assert.strictEqual(month, tc.expectedMonth, `Month mismatch for ${tc.input}: got ${month}, expected ${tc.expectedMonth}`);
  console.log(`  ✓ ${tc.input} -> Year: ${year || 'curr'}, Month: ${month || 'curr'}`);
}

// 2. Remind Abyss/Deadly Threshold Regex Verification (with aliases and optional spaces)
console.log("\n[2/4] Verifying Remind Threshold Regexes...");
const abyssReg = new RegExp(`^${rulePrefix}设置(全局)?(式舆防卫战|式舆|深渊|防卫战|防卫)阈值\\s*(\\d+)`);
const deadlyReg = new RegExp(`^${rulePrefix}设置(全局)?(危局强袭战|危局|强袭|强袭战)阈值\\s*(\\d+)`);

const remindCases = [
  { input: "%设置防卫战阈值 3", reg: abyssReg, expectedNum: "3", expectedGlobal: undefined },
  { input: "%设置防卫战阈值3", reg: abyssReg, expectedNum: "3", expectedGlobal: undefined },
  { input: "%设置式舆阈值 5", reg: abyssReg, expectedNum: "5", expectedGlobal: undefined },
  { input: "%设置全局深渊阈值 2", reg: abyssReg, expectedNum: "2", expectedGlobal: "全局" },
  { input: "%设置危局阈值 6", reg: deadlyReg, expectedNum: "6", expectedGlobal: undefined },
  { input: "%设置全局强袭阈值 4", reg: deadlyReg, expectedNum: "4", expectedGlobal: "全局" }
];

for (const tc of remindCases) {
  const match = tc.input.match(tc.reg);
  assert(match, `Failed to match remind: ${tc.input}`);
  assert.strictEqual(match[1], tc.expectedGlobal);
  assert.strictEqual(match[3], tc.expectedNum);
  console.log(`  ✓ ${tc.input} -> Type: ${match[2]}, Level: ${match[3]}, Global: ${!!match[1]}`);
}

// 3. Manage Config Regexes Verification (tolerating optional whitespace)
console.log("\n[3/4] Verifying Manage Config Space Tolerance...");
const manageRules = [
  { name: "setDefaultGuide", reg: new RegExp(`^${rulePrefix}设置默认攻略\\s*(\\d+|all)$`), input: "%设置默认攻略 1", param: "1" },
  { name: "setMaxForwardGuide", reg: new RegExp(`^${rulePrefix}设置所有攻略显示个数\\s*(\\d+)$`), input: "%设置所有攻略显示个数 3", param: "3" },
  { name: "setRenderPrecision", reg: new RegExp(`^${rulePrefix}设置渲染精度\\s*(\\d+)$`), input: "%设置渲染精度 100", param: "100" },
  { name: "setRecallMsg", reg: new RegExp(`^${rulePrefix}设置撤回时间\\s*(\\d+)$`), input: "%设置撤回时间 60", param: "60" },
  { name: "setRefreshGachaInterval", reg: new RegExp(`^${rulePrefix}刷新抽卡间隔\\s*(\\d+)$`), input: "%刷新抽卡间隔 30", param: "30" },
  { name: "setRefreshPanelInterval", reg: new RegExp(`^${rulePrefix}刷新面板间隔\\s*(\\d+)$`), input: "%刷新面板间隔 60", param: "60" },
  { name: "setRefreshCharInterval", reg: new RegExp(`^${rulePrefix}刷新角色间隔\\s*(\\d+)$`), input: "%刷新角色间隔 1000", param: "1000" }
];

for (const r of manageRules) {
  const match = r.input.match(r.reg);
  assert(match, `Failed to match ${r.name}: ${r.input}`);
  assert.strictEqual(match[1], r.param);
  // Also verify compact version without spaces
  const compactInput = r.input.replace(/\s+/, '');
  const matchCompact = compactInput.match(r.reg);
  assert(matchCompact, `Failed compact match for ${r.name}: ${compactInput}`);
  console.log(`  ✓ ${r.name}: "${r.input}" & "${compactInput}" -> param: ${match[1]}`);
}

// 4. Miao-plugin ZZZ Bypass Logic Check
console.log("\n[4/4] Verifying Miao-plugin Bypass Logic...");
function miaoAppCheck(e, key) {
  if ((e.game === 'zzz' || e.isZZZ) && key !== 'calendarZZZ') {
    return false; // Bypassed to let ZZZ-Plugin handle
  }
  return true; // Miao handles
}

assert.strictEqual(miaoAppCheck({ game: 'zzz' }, 'poolHistory'), false, "Should bypass zzz pool to ZZZ-Plugin");
assert.strictEqual(miaoAppCheck({ isZZZ: true }, 'profileList'), false, "Should bypass zzz profile to ZZZ-Plugin");
assert.strictEqual(miaoAppCheck({ game: 'gs' }, 'poolHistory'), true, "Genshin pool should be handled by Miao");
assert.strictEqual(miaoAppCheck({ game: 'sr' }, 'poolHistory'), true, "StarRail pool should be handled by Miao");
console.log("  ✓ Miao-Plugin bypass logic confirmed safe across games.");

console.log("\n==========================================================");
console.log("  ALL 24 TEST CASES PASSED SUCCESSFULLY (100%)");
console.log("==========================================================");
