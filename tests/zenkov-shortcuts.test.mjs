import test from 'node:test';
import assert from 'node:assert/strict';

// Test 1: Shortcut mappings for Bagel Plan and Enigma of the Labyrinth
test('zzzShortcuts mappings for Bagel Plan (贝果计划) and Enigma of the Labyrinth (迷宫诡域)', async () => {
    let zzzShortcuts;
    try {
        zzzShortcuts = (await import('./plugins/example/zzzShortcuts.js')).zzzShortcuts;
    } catch {
        zzzShortcuts = (await import('../plugins/example/zzzShortcuts.js')).zzzShortcuts;
    }
    const shortcut = new zzzShortcuts();

    const check = async (input, raw_message = null) => {
        const e = {
            msg: input,
            raw_message: raw_message || input,
            reply: async () => {}
        };
        await shortcut.accept(e);
        return e.msg;
    };

    // 1. Overview queries
    assert.equal(await check('/贝果'), '#绝区零贝果');
    assert.equal(await check('贝果'), '#绝区零贝果');
    assert.equal(await check('/贝果计划'), '#绝区零贝果');
    assert.equal(await check('贝果计划'), '#绝区零贝果');
    assert.equal(await check('/迷宫'), '#绝区零贝果');
    assert.equal(await check('/迷宫诡域'), '#绝区零贝果');
    assert.equal(await check('搜打撤'), '#绝区零贝果');
    assert.equal(await check('/绝科夫'), '#绝区零贝果');

    // 2. Refresh / Update overview queries
    assert.equal(await check('/更新贝果'), '#绝区零贝果');
    assert.equal(await check('更新贝果'), '#绝区零贝果');
    assert.equal(await check('/刷新贝果'), '#绝区零贝果');
    assert.equal(await check('/更新贝果计划'), '#绝区零贝果');
    assert.equal(await check('刷新迷宫'), '#绝区零贝果');

    // 3. Detail and battle record queries
    assert.equal(await check('/贝果战绩'), '#绝区零贝果战绩');
    assert.equal(await check('贝果战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/贝果计划战绩'), '#绝区零贝果战绩');
    assert.equal(await check('贝果计划战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/贝果记录'), '#绝区零贝果战绩');
    assert.equal(await check('/贝果详情'), '#绝区零贝果战绩');
    assert.equal(await check('/迷宫战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/搜打撤战绩'), '#绝区零贝果战绩');

    // 4. Refresh / Update detail queries
    assert.equal(await check('/更新贝果战绩'), '#绝区零贝果战绩');
    assert.equal(await check('更新贝果战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/刷新贝果战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/更新贝果计划战绩'), '#绝区零贝果战绩');
    assert.equal(await check('/刷新迷宫战绩'), '#绝区零贝果战绩');

    // 5. Unrelated / existing commands must not be broken
    assert.equal(await check('/便签'), '#绝区零便签');
    assert.equal(await check('/更新展柜'), '#绝区零更新展柜');
    assert.equal(await check('/抽卡记录'), '#绝区零抽卡分析');
});

// Test 2: Zenkov regex matching rules
test('Zenkov regex rule verification for bagel keywords and update prefix', () => {
    const rulePrefix = '^[#%/]?(?:zzz|ZZZ|绝区零)?';
    
    // Overview regex
    const regOverview = new RegExp(`${rulePrefix}(更新|刷新)?(迷宫诡域|迷宫|诡域|搜打撤|贝果|贝果计划|塔科夫|塔可夫|塔克夫|鸭科夫|绝科夫)$`, 'i');
    
    // Detail regex
    const regDetail = new RegExp(`${rulePrefix}(更新|刷新)?(迷宫诡域|迷宫|诡域|搜打撤|贝果|贝果计划|塔科夫|塔可夫|塔克夫|鸭科夫|绝科夫)(战绩|记录|详情|回顾)$`, 'i');

    // Matching overview
    assert.ok(regOverview.test('#zzz贝果'));
    assert.ok(regOverview.test('#zzz贝果计划'));
    assert.ok(regOverview.test('#绝区零贝果'));
    assert.ok(regOverview.test('%贝果'));
    assert.ok(regOverview.test('/贝果'));
    assert.ok(regOverview.test('#zzz更新贝果'));
    assert.ok(regOverview.test('#绝区零刷新贝果计划'));
    assert.ok(regOverview.test('#zzz迷宫诡域'));
    assert.ok(regOverview.test('#zzz搜打撤'));

    // Matching detail
    assert.ok(regDetail.test('#zzz贝果战绩'));
    assert.ok(regDetail.test('#zzz贝果计划战绩'));
    assert.ok(regDetail.test('#绝区零贝果战绩'));
    assert.ok(regDetail.test('#zzz贝果详情'));
    assert.ok(regDetail.test('#zzz贝果记录'));
    assert.ok(regDetail.test('#zzz更新贝果战绩'));
    assert.ok(regDetail.test('#绝区零刷新贝果计划战绩'));
    assert.ok(regDetail.test('#zzz迷宫战绩'));
    assert.ok(regDetail.test('#zzz绝科夫战绩'));

    // Rejection of invalid commands
    assert.ok(!regOverview.test('#zzz贝果抽卡'));
    assert.ok(!regOverview.test('#zzz艾莲面板'));
    assert.ok(!regDetail.test('#zzz贝果'));
});
