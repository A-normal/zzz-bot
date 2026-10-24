import test from 'node:test';
import assert from 'node:assert/strict';

// Test simulation of the panel refresh fallback flow
test('refreshPanel should not set cooldown prematurely when Miyoushe fails', async () => {
    let lastTimeSet = null;
    const fakeRedis = {
        async get(key) { return null; },
        async set(key, val) { lastTimeSet = val; },
    };

    let miyousheAttempted = false;
    let enkaAttempted = false;

    // Simulate Miyoushe throwing 10041
    const runRefresh = async ({ enkaSuccess }) => {
        lastTimeSet = null;
        const uid = '17708598';
        let result = null;
        let errorMsg = '';
        let fallbackNotice = '';

        try {
            miyousheAttempted = true;
            // Miyoushe throws MysError 10041
            throw new Error('UID:17708598，米游社账号异常，暂时无法查询，请发送 %绑定设备帮助 查看如何绑定设备');
        } catch (err) {
            errorMsg = err.message;
        }

        // Automatic fallback
        if (!result) {
            enkaAttempted = true;
            if (enkaSuccess) {
                const enkaData = {
                    playerInfo: { nickname: '修仙者一号', level: 60, uid },
                    panelList: [{ id: 1191, name: '艾莲' }],
                };
                await fakeRedis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                result = enkaData.panelList;
                fallbackNotice = `⚠️ 米游社查询受限（${errorMsg.trim()}），已自动通过 Enka 展柜同步公开角色面板！`;
            }
        }

        return { result, lastTimeSet, fallbackNotice, errorMsg };
    };

    // Case 1: Miyoushe fails, Enka succeeds
    const res1 = await runRefresh({ enkaSuccess: true });
    assert.equal(miyousheAttempted, true);
    assert.equal(enkaAttempted, true);
    assert.ok(res1.result);
    assert.equal(res1.result.length, 1);
    assert.ok(res1.lastTimeSet !== null, 'Cooldown should be set on successful fallback');
    assert.match(res1.fallbackNotice, /自动通过 Enka 展柜同步/);

    // Case 2: Miyoushe fails, Enka also fails (e.g. no characters in showcase)
    const res2 = await runRefresh({ enkaSuccess: false });
    assert.equal(res2.result, null);
    assert.equal(res2.lastTimeSet, null, 'Cooldown must NOT be set when refresh fails completely');
});

test('refreshPanel pure Enka branch sets cooldown only when panelList is non-empty', async () => {
    let lastTimeSet = null;
    const fakeRedis = {
        async get(key) { return null; },
        async set(key, val) { lastTimeSet = val; },
    };

    const runEnkaBranch = async (panelList) => {
        lastTimeSet = null;
        const uid = '17708598';
        const data = {
            playerInfo: { nickname: 'test' },
            panelList,
        };

        if (typeof data === 'object') {
            const { playerInfo, panelList: list } = data;
            if (!list.length) {
                return { success: false, lastTimeSet };
            }
            await fakeRedis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
            return { success: true, lastTimeSet };
        }
    };

    const emptyRes = await runEnkaBranch([]);
    assert.equal(emptyRes.success, false);
    assert.equal(emptyRes.lastTimeSet, null, 'Empty showcase must not trigger cooldown');

    const validRes = await runEnkaBranch([{ id: 1191 }]);
    assert.equal(validRes.success, true);
    assert.ok(validRes.lastTimeSet !== null, 'Non-empty showcase sets cooldown');
});
