import test from 'node:test';
import assert from 'node:assert/strict';

// Test 1: Shortcut mappings
test('zzzShortcuts mappings for new showcase and panel commands', async () => {
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

    // Showcase update commands
    assert.equal(await check('/更新展柜'), '#绝区零更新展柜');
    assert.equal(await check('更新展柜'), '#绝区零更新展柜');
    assert.equal(await check('/刷新展柜'), '#绝区零更新展柜');
    assert.equal(await check('展柜更新'), '#绝区零更新展柜');
    assert.equal(await check('/更新展柜面板'), '#绝区零更新展柜');

    // Single-character panel update commands
    assert.equal(await check('/更新面板 艾莲'), '#绝区零更新面板 艾莲');
    assert.equal(await check('更新面板 艾莲'), '#绝区零更新面板 艾莲');
    assert.equal(await check('/刷新面板 菲欧妮'), '#绝区零更新面板 菲欧妮');
    assert.equal(await check('刷新面板 简'), '#绝区零更新面板 简');

    // Bulk panel update commands
    assert.equal(await check('/更新面板'), '#绝区零更新面板');
    assert.equal(await check('更新面板'), '#绝区零更新面板');
    assert.equal(await check('/刷新面板'), '#绝区零更新面板');
    assert.equal(await check('全角色面板'), '#绝区零更新面板');

    // Panel queries
    assert.equal(await check('/面板 艾莲'), '#绝区零艾莲面板');
    assert.equal(await check('面板 简'), '#绝区零简面板');
    assert.equal(await check('/面板'), '#绝区零面板列表');
    assert.equal(await check('面板列表'), '#绝区零面板列表');
});

// Test 2: Dynamic self-healing partner dictionary and reverse deduction
test('Dynamic partner dictionary and reverse self-healing from user panel data', async () => {
    const dynamicMap = {};
    let saved = false;

    const registerDynamicPartner = (id, info = {}) => {
        if (!id) return;
        const key = String(id);
        const name = info.name || info.name_mi18n || '';
        const full_name = info.full_name || info.full_name_mi18n || name;
        dynamicMap[key] = {
            id: Number(id),
            name,
            full_name,
            en_name: info.en_name || '',
        };
        saved = true;
    };

    const aliasToId = (name) => {
        for (const [id, data] of Object.entries(dynamicMap)) {
            if (data.name === name || data.full_name === name) return Number(id);
        }
        return null;
    };

    // Before learning:
    assert.equal(aliasToId('菲欧妮'), null);

    // Simulated getPanelOrigin self-describing fallback logic:
    const mockUserPanelData = [
        { id: 1191, name: '艾莲' },
        { id: 1641, name_mi18n: '菲欧妮', full_name_mi18n: '菲欧妮·蕾法爱菈', rarity: 'S' }
    ];

    const getPanelOriginSim = (queryName) => {
        let id = aliasToId(queryName);
        let result = id ? mockUserPanelData.find(item => item.id === id) : null;

        if (!result && mockUserPanelData.length > 0 && queryName) {
            const cleanName = String(queryName).trim();
            const found = mockUserPanelData.find(item => {
                const n1 = item.name_mi18n || '';
                const n2 = item.full_name_mi18n || '';
                const n3 = item.name || '';
                return n1 === cleanName || n2 === cleanName || n3 === cleanName ||
                       (n2 && n2.includes(cleanName)) || (cleanName.length >= 2 && n1.includes(cleanName));
            });
            if (found) {
                result = found;
                id = found.id;
                registerDynamicPartner(id, {
                    id,
                    name: found.name_mi18n || found.name || cleanName,
                    full_name: found.full_name_mi18n || found.name_mi18n || cleanName,
                    rarity: found.rarity || 'S'
                });
            }
        }
        return result || (id ? null : false);
    };

    // First query: triggers self-healing
    const foundChar = getPanelOriginSim('菲欧妮');
    assert.ok(foundChar);
    assert.equal(foundChar.id, 1641);
    assert.equal(saved, true);
    assert.equal(dynamicMap['1641'].name, '菲欧妮');
    assert.equal(dynamicMap['1641'].full_name, '菲欧妮·蕾法爱菈');

    // Subsequent query: hits dynamic dictionary directly
    assert.equal(aliasToId('菲欧妮'), 1641);
    const directHit = getPanelOriginSim('菲欧妮');
    assert.ok(directHit);
    assert.equal(directHit.id, 1641);
});

// Test 3: 5-minute confirmation logic for bulk update
test('Bulk panel update 5-minute double confirmation flow', async () => {
    const redisStore = new Map();
    const redisMock = {
        async get(k) { return redisStore.get(k) || null; },
        async set(k, v, opts) { redisStore.set(k, v); },
        async del(k) { redisStore.delete(k); },
    };

    const handleBulkUpdateSimulation = async (uid) => {
        const confirmKey = `ZZZ:PANEL:CONFIRM:${uid}`;
        const isConfirmed = await redisMock.get(confirmKey);

        if (!isConfirmed) {
            await redisMock.set(confirmKey, '1', { EX: 300 });
            return { executed: false, message: '请在5分钟内再次发送【#更新面板】确认执行' };
        }

        await redisMock.del(confirmKey);
        return { executed: true, message: '全量更新已开始' };
    };

    const uid = '17708598';

    // Call 1: First request triggers warning and sets 5-minute key
    const res1 = await handleBulkUpdateSimulation(uid);
    assert.equal(res1.executed, false);
    assert.match(res1.message, /5分钟内再次发送/);
    assert.equal(redisStore.get(`ZZZ:PANEL:CONFIRM:${uid}`), '1');

    // Call 2: Second request within 5 minutes proceeds with execution
    const res2 = await handleBulkUpdateSimulation(uid);
    assert.equal(res2.executed, true);
    assert.equal(res2.message, '全量更新已开始');
    assert.equal(redisStore.get(`ZZZ:PANEL:CONFIRM:${uid}`), undefined);
});
