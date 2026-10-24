import test from 'node:test';
import assert from 'node:assert/strict';

test('zzzShortcuts mappings for 兑换码 (code), 日历 (calendar), and 月报 (monthly)', async () => {
    let zzzShortcuts;
    try {
        zzzShortcuts = (await import('../plugins/example/zzzShortcuts.js')).zzzShortcuts;
    } catch {
        zzzShortcuts = (await import('./plugins/example/zzzShortcuts.js')).zzzShortcuts;
    }
    const shortcut = new zzzShortcuts();

    const check = async (input, raw_message = null) => {
        let repliedTip = null;
        const e = {
            msg: input,
            raw_message: raw_message || input,
            reply: async (msg) => { repliedTip = msg; }
        };
        const ret = await shortcut.accept(e);
        return { msg: e.msg, game: e.game, ret, repliedTip };
    };

    // 1. 兑换码 / code
    const c1 = await check('/兑换码');
    assert.equal(c1.msg, '#绝区零兑换码');
    assert.equal(c1.game, 'zzz');
    assert.equal(c1.ret, false);
    assert.equal(c1.repliedTip, null);

    const c2 = await check('兑换码');
    assert.equal(c2.msg, '#绝区零兑换码');
    assert.equal(c2.game, 'zzz');

    const c3 = await check('%兑换码');
    assert.equal(c3.msg, '#绝区零兑换码');
    assert.equal(c3.game, 'zzz');

    const c4 = await check('#兑换码');
    assert.equal(c4.msg, '#绝区零兑换码');
    assert.equal(c4.game, 'zzz');

    const c5 = await check('/code');
    assert.equal(c5.msg, '#绝区零兑换码');
    assert.equal(c5.game, 'zzz');

    const c6 = await check('code');
    assert.equal(c6.msg, '#绝区零兑换码');
    assert.equal(c6.game, 'zzz');

    const c7 = await check('/前瞻兑换码');
    assert.equal(c7.msg, '#绝区零兑换码');
    assert.equal(c7.game, 'zzz');

    // 2. 日历 / cal
    const cal1 = await check('/日历');
    assert.equal(cal1.msg, '#绝区零日历');
    assert.equal(cal1.game, 'zzz');

    const cal2 = await check('日历');
    assert.equal(cal2.msg, '#绝区零日历');

    const cal3 = await check('/cal');
    assert.equal(cal3.msg, '#绝区零日历');

    // 3. 月报 / 菲林
    const m1 = await check('/月报');
    assert.equal(m1.msg, '#绝区零月报');
    assert.equal(m1.game, 'zzz');

    const m2 = await check('月报');
    assert.equal(m2.msg, '#绝区零月报');

    const m3 = await check('/菲林');
    assert.equal(m3.msg, '#绝区零菲林');

    // 4. 未知斜杠指令仍然会被拦截保护，不穿透
    const unknown = await check('/未知指令xyz');
    assert.equal(unknown.ret, 'return');
    assert.ok(unknown.repliedTip && unknown.repliedTip.includes('没有快捷指令'));

    // 5. 既有基础指令不受影响
    const note = await check('/便签');
    assert.equal(note.msg, '#绝区零便签');
    assert.equal(note.game, 'zzz');
});
