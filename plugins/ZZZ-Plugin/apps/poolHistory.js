import fs from 'node:fs';
import path from 'node:path';
import { aliasToName } from '../lib/convert/char.js';
import common from '../../../../lib/common/common.js';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import fetch from 'node-fetch';
const DATA_URLS = [
    'https://ghproxy.net/https://raw.githubusercontent.com/iaoongin/GachaClock/main/spider/data/zzz/history.json',
    'https://raw.githubusercontent.com/iaoongin/GachaClock/main/spider/data/zzz/history.json'
];
export class PoolHistory extends ZZZPlugin {
    dataCacheKey;
    dataCacheExpireKey;
    queryAllPoolMsgCacheKey;
    constructor() {
        super({
            name: '[ZZZ-Plugin]PoolHistory',
            dsc: '查询绝区零全角色/武器卡池记录',
            event: 'message',
            priority: settings.getConfig('priority')?.panel ?? 70,
            rule: [
                {
                    reg: `${rulePrefix}.+(复刻|卡池)(统计|记录|历史)$`,
                    fnc: 'dispatchHandler'
                },
                {
                    reg: `${rulePrefix}(当前|本期|当期)?卡池$`,
                    fnc: 'queryCurrentPool'
                },
                {
                    reg: `${rulePrefix}(复刻|卡池)(统计|记录|历史)$`,
                    fnc: 'queryAllPool'
                },
                {
                    reg: `${rulePrefix}v?(\\d+\\.\\d+)(上半|下半)?卡池$`,
                    fnc: 'queryVersionPool'
                },
                {
                    reg: `${rulePrefix}(刷新|更新|重载)卡池(记录|历史)?$`,
                    fnc: 'reloadPoolData'
                }
            ]
        });
        this.dataCacheKey = 'ZZZ:PoolHistory:Data';
        this.dataCacheExpireKey = 'ZZZ:PoolHistory:Data:Expire';
        this.queryAllPoolMsgCacheKey = 'ZZZ:PoolHistory:queryAllPoolMsg';
    }
    parseTime(pool) {
        const { startTime, endTime } = pool;
        if (!startTime || !endTime)
            return { startTime: null, endTime: null };
        return { startTime: new Date(startTime), endTime: new Date(endTime) };
    }
    async dispatchHandler() {
        const rawContent = this.parseMsgPrefix().replace(/(复刻|卡池)(统计|记录|历史)$/u, '').trim();
        if (/^(五星|S级?)?(角色|代理人)$/i.test(rawContent)) {
            return await this.handleSummary('S', '角色');
        }
        if (/^(四星|A级?)?(角色|代理人)$/i.test(rawContent)) {
            return await this.handleSummary('A', '角色');
        }
        if (/^(五星|S级?)(武器|音擎)$/i.test(rawContent)) {
            return await this.handleSummary('S', '武器');
        }
        if (/^(四星|A级?)(武器|音擎)$/i.test(rawContent)) {
            return await this.handleSummary('A', '武器');
        }
        const name = aliasToName(rawContent) || rawContent;
        return await this.handleHistoryQuery(name);
    }
    async handleSummary(targetRank, targetType) {
        const data = await this.fetchData();
        if (!data)
            return this.reply('卡池历史记录数据获取失败');
        const now = new Date();
        const itemMap = new Map();
        data.forEach(pool => {
            if (pool.type !== targetType)
                return;
            const { startTime, endTime } = this.parseTime(pool);
            if (!startTime || !endTime)
                return;
            let targets = [];
            if (targetRank === 'S') {
                if (pool.s)
                    targets.push(pool.s);
            }
            else {
                if (Array.isArray(pool.a))
                    targets = pool.a;
            }
            targets.forEach(name => {
                if (!itemMap.has(name) || endTime > itemMap.get(name).endTime) {
                    itemMap.set(name, { startTime, endTime });
                }
            });
        });
        const historyList = [];
        itemMap.forEach((timeInfo, name) => {
            if (now >= timeInfo.startTime && now <= timeInfo.endTime)
                return;
            if (now < timeInfo.startTime)
                return;
            const diff = now.getTime() - timeInfo.endTime.getTime();
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            historyList.push({ name, days: days > 0 ? days : 0 });
        });
        historyList.sort((a, b) => b.days - a.days);
        const historyStr = historyList.map(r => `${r.name}: ${String(r.days).padStart(3, ' ')}天未复刻`).join('\n');
        const displayType = targetType === '武器' ? '音擎' : '代理人';
        return this.reply(`【 ${targetRank}级${displayType}复刻统计 】\n${historyStr}`);
    }
    async handleHistoryQuery(queryName) {
        const data = await this.fetchData();
        if (!data)
            return this.reply('卡池历史记录数据获取失败');
        const records = data.filter(pool => {
            if (pool.s === queryName)
                return true;
            if (Array.isArray(pool.a) && pool.a.includes(queryName))
                return true;
            return false;
        });
        if (records.length === 0) {
            return this.reply(`未找到【${queryName}】卡池记录，请确保角色名称/别称存在`);
        }
        const firstHit = records[0];
        const isS = firstHit.s === queryName;
        const typeStr = firstHit.type === '武器' ? '音擎' : '代理人';
        const rarityStr = isS ? 'S级' : 'A级';
        const listStr = records.map((pool, index) => {
            const timeRange = pool.timer.replace(/ \d{2}:\d{2}:\d{2}/g, '');
            return `${index + 1}. ${pool.version} (${timeRange})`;
        }).join('\n');
        return this.reply(`【 ${queryName}(${rarityStr}${typeStr}) 卡池记录 】\n${listStr}`);
    }
    async queryCurrentPool() {
        const data = await this.fetchData();
        if (!data)
            return this.reply('卡池历史记录数据获取失败');
        const now = new Date();
        const activePools = data.filter(pool => {
            const { startTime, endTime } = this.parseTime(pool);
            return startTime && endTime && now >= startTime && now <= endTime;
        });
        if (activePools.length === 0)
            return this.reply('当前没有正在进行的活动卡池。');
        const replyMsg = [`=== 📅 绝区零本期卡池 ===\n`];
        if (activePools.length > 0) {
            const sample = activePools[0];
            const { endTime } = this.parseTime(sample);
            const remainingDays = Math.ceil((endTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            replyMsg.push(`版本：v${sample.version}\n时间：${sample.timer}\n时间：剩余约${remainingDays}天\n`);
        }
        const rolePools = activePools.filter(p => p.type === '角色');
        const weaponPools = activePools.filter(p => p.type === '武器');
        if (!rolePools.length && !weaponPools.length) {
            return this.reply('暂无卡池数据信息');
        }
        if (rolePools.length > 0) {
            replyMsg.push(`\n【 角色调频 】\n`);
            rolePools.forEach(p => {
                const aRoles = Array.isArray(p.a) ? p.a.join('，') : p.a;
                replyMsg.push(`◈ S-${p.s} | A-${aRoles}\n`);
                replyMsg.push(segment.image(p.img));
            });
        }
        if (weaponPools.length > 0) {
            replyMsg.push(`\n【 音擎调频 】\n`);
            weaponPools.forEach(p => {
                const aWeapons = Array.isArray(p.a) ? p.a.join('，') : p.a;
                replyMsg.push(`◈ S-${p.s} | A-${aWeapons}\n`);
                replyMsg.push(segment.image(p.img));
            });
        }
        return this.reply(replyMsg);
    }
    async queryAllPool() {
        let progressRes = null;
        try {
            progressRes = await this.reply('正在整理绝区零全版本卡池记录，请稍候...', false, { recallMsg: 60 });
        } catch {
            // ignore progress notice failure
        }
        try {
            const old = await redis.get(this.queryAllPoolMsgCacheKey);
            if (old) {
                try {
                    if (old.startsWith('{') || old.startsWith('[')) {
                        redis.del(this.queryAllPoolMsgCacheKey);
                    } else {
                        if (progressRes?.message_id) {
                            try {
                                if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                                else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                            } catch {}
                        }
                        return await this.reply(old);
                    }
                } catch {
                    redis.del(this.queryAllPoolMsgCacheKey);
                }
            }
            const data = await this.fetchData();
            if (!data) {
                if (progressRes?.message_id) {
                    try {
                        if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                        else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                    } catch {}
                }
                return false;
            }
            const versionList = [...new Set(data.map(p => p.version.replace(/(上半|下半)$/u, '')))].sort((a, b) => {
                const [aMajor, aMinor] = a.split('.').map(Number);
                const [bMajor, bMinor] = b.split('.').map(Number);
                if (bMajor !== aMajor) return bMajor - aMajor;
                return bMinor - aMinor;
            });
            const lines = ['【 绝区零全版本卡池记录（时间线逆序）】\n'];
            for (const v of versionList) {
                const pools = data.filter(p => p.version.startsWith(v));
                if (!pools.length) continue;
                const versionStages = [...new Set(pools.map(p => p.version))].sort((a, b) => {
                    if (a.includes('下半') && b.includes('上半')) return -1;
                    if (a.includes('上半') && b.includes('下半')) return 1;
                    return b.localeCompare(a);
                });
                for (const stage of versionStages) {
                    const stagePools = pools.filter(p => p.version === stage);
                    const timerDisplay = stagePools[0]?.timer?.replace(/ \d{2}:\d{2}:\d{2}/g, '').trim() || '';
                    lines.push(`【 v${stage} 】${timerDisplay ? ' ' + timerDisplay : ''}`);
                    const rolePools = stagePools.filter(p => p.type === '角色');
                    const weaponPools = stagePools.filter(p => p.type === '武器');
                    if (rolePools.length > 0) {
                        const roleStrs = rolePools.map(p => {
                            const aRoles = Array.isArray(p.a) ? p.a.join('、') : (p.a || '');
                            return `S-${p.s}${aRoles ? ' | A-' + aRoles : ''}`;
                        });
                        lines.push(`◈ 角色：${roleStrs.join('；')}`);
                    }
                    if (weaponPools.length > 0) {
                        const weaponStrs = weaponPools.map(p => {
                            const aWeapons = Array.isArray(p.a) ? p.a.join('、') : (p.a || '');
                            return `S-${p.s}${aWeapons ? ' | A-' + aWeapons : ''}`;
                        });
                        lines.push(`◈ 音擎：${weaponStrs.join('；')}`);
                    }
                    lines.push('');
                }
            }
            const msg = lines.join('\n').trim();
            redis.set(this.queryAllPoolMsgCacheKey, msg, {
                EX: 7 * 24 * 60 * 60
            });
            if (progressRes?.message_id) {
                try {
                    if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                    else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                } catch {}
            }
            return await this.reply(msg);
        } catch (err) {
            logger.error(`[ZZZ-Plugin] 全卡池记录生成失败: ${err.message || err}`);
            if (progressRes?.message_id) {
                try {
                    if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                    else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                } catch {}
            }
            return await this.reply(`查询全卡池记录失败：${err.message || '未知错误'}`);
        }
    }
    async queryVersionPool() {
        const data = await this.fetchData();
        if (!data)
            return this.reply('卡池历史记录数据获取失败');
        const rawContent = this.parseMsgPrefix();
        const match = rawContent.match(/^v?(\d+\.\d+)(上半|下半)?卡池$/);
        if (!match)
            return false;
        const [, version, phase] = match;
        const replyMsg = this.generatePoolMsg(data, version, phase);
        if (replyMsg) {
            return this.reply(replyMsg);
        }
    }
    generatePoolMsg(data, version, phase) {
        const pools = data.filter(pool => {
            if (!pool.version.startsWith(version))
                return false;
            if (phase && !pool.version.includes(phase))
                return false;
            return true;
        });
        if (pools.length === 0) {
            this.reply(`未查询到绝区零${version}${phase || ''}版本的卡池数据`);
            return false;
        }
        const versionStages = [...new Set(pools.map(p => p.version))].sort((a, b) => {
            if (a.includes('上半') && b.includes('下半'))
                return -1;
            if (a.includes('下半') && b.includes('上半'))
                return 1;
            return a.localeCompare(b);
        });
        const replyMsg = [`【 绝区零 v${versionStages.length === 1 ? versionStages[0] : version} 卡池 】\n`];
        for (const stage of versionStages) {
            const stagePools = pools.filter(p => p.version === stage);
            const timerDisplay = stagePools[0]?.timer?.replace(/ \d{2}:\d{2}:\d{2}/g, '');
            const rolePools = stagePools.filter(p => p.type === '角色');
            const weaponPools = stagePools.filter(p => p.type === '武器');
            if (versionStages.length > 1) {
                replyMsg.push(`【 ${stage} 】\n`);
            }
            replyMsg.push(`⏱️ ${timerDisplay}\n`);
            if (rolePools.length > 0) {
                for (const p of rolePools) {
                    const aRoles = Array.isArray(p.a) ? p.a.join('，') : p.a;
                    replyMsg.push(`◈ 角色：S-${p.s} | A-${aRoles}\n`);
                    replyMsg.push(segment.image(p.img));
                }
            }
            if (weaponPools.length > 0) {
                for (const p of weaponPools) {
                    const aWeapons = Array.isArray(p.a) ? p.a.join('，') : p.a;
                    replyMsg.push(`◈ 音擎：S-${p.s} | A-${aWeapons}\n`);
                    replyMsg.push(segment.image(p.img));
                }
            }
        }
        return replyMsg;
    }
    async reloadPoolData() {
        await redis.del(this.dataCacheKey);
        await redis.del(this.dataCacheExpireKey);
        await redis.del(this.queryAllPoolMsgCacheKey);
        const data = await this.fetchData(true);
        if (data && data.length > 0) {
            const versions = [...new Set(data.map(p => p.version))];
            return this.reply(`【绝区零卡池记录】\n✅ 卡池数据刷新成功！\n共收录 ${data.length} 条记录，覆盖版本：${versions[0]} ~ ${versions[versions.length - 1]}`);
        } else {
            return this.reply('❌ 刷新卡池数据失败，请检查日志。');
        }
    }
    async fetchData(forceReload = false) {
        if (!forceReload) {
            const cacheValid = await redis.get(this.dataCacheExpireKey);
            if (cacheValid) {
                const cache = await redis.get(this.dataCacheKey);
                if (cache) {
                    return JSON.parse(cache);
                }
                redis.del(this.dataCacheExpireKey);
                redis.del(this.dataCacheKey);
            }
        }
        let rawData;
        // 1. 优先读取本地完整维护的 resources/history.json
        const localPath = './plugins/ZZZ-Plugin/resources/history.json';
        if (fs.existsSync(localPath)) {
            try {
                const localContent = fs.readFileSync(localPath, 'utf8');
                const parsed = JSON.parse(localContent);
                if (Array.isArray(parsed) && parsed.length >= 100) {
                    rawData = parsed;
                }
            } catch (e) {
                logger.warn(`[ZZZ-Plugin] 读取本地卡池历史文件失败: ${e.message}`);
            }
        }
        // 2. 本地不可用时尝试远程 URL 备选
        if (!rawData) {
            let lastErr = null;
            for (const url of DATA_URLS) {
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: { 'Cache-Control': 'no-cache' },
                        signal: AbortSignal.timeout(5000)
                    });
                    if (response.ok) {
                        rawData = await response.json();
                        break;
                    }
                } catch (err) {
                    lastErr = err;
                }
            }
        }
        // 3. 兜底旧缓存
        if (!rawData) {
            const cache = await redis.get(this.dataCacheKey);
            if (cache) {
                return JSON.parse(cache);
            }
            logger.error('[ZZZ-Plugin] 卡池历史数据获取失败: 本地或网络数据源均不可用');
            return this.reply('卡池历史记录数据获取失败: 本地或网络数据源均不可用');
        }
        const data = this.processData(rawData);
        if (data) {
            redis.set(this.dataCacheExpireKey, '1', {
                EX: 24 * 60 * 60
            });
            redis.set(this.dataCacheKey, JSON.stringify(data));
            redis.del(this.queryAllPoolMsgCacheKey);
            return data;
        }
    }
    processData(data) {
        if (!data.find(v => v.version === '1.0上半')) {
            data.push({
                img: 'https://patchwiki.biligame.com/images/zzz/thumb/7/7f/8pesvtvchbs3t2jhqjhckd9k08pe7ui.png/900px-%E7%8B%AC%E5%AE%B6%E9%A2%91%E6%AE%B5001%E6%9C%9F.png',
                title: '「慵懒逐浪」001期独家频段',
                type: '角色',
                version: '1.0上半',
                timer: '公测开启后 ~ 2024/07/24 11:59:59',
                s: '艾莲',
                a: [
                    '安东',
                    '苍角'
                ],
                img_path: 'img/zzz/history/「慵懒逐浪」001期独家频段.png'
            }, {
                img: 'https://patchwiki.biligame.com/images/zzz/thumb/3/32/gs2uajlo6v2h6pljzij84wdiwhu9fkj.png/900px-%E9%9F%B3%E6%93%8E%E9%A2%91%E6%AE%B5001%E6%9C%9F.png',
                title: '「喧哗奏鸣」001期音擎频段',
                type: '武器',
                version: '1.0上半',
                timer: '公测开启后 ~ 2024/07/24 11:59:59',
                s: '深海访客',
                a: [
                    '含羞恶面',
                    '旋钻机-赤轴'
                ],
                img_path: 'img/zzz/history/「喧哗奏鸣」001期音擎频段.png'
            });
        }
        data.forEach(pool => {
            const parts = pool.timer.split('~');
            if (parts.length >= 2) {
                const endStr = parts[1].trim();
                const endTime = new Date(endStr);
                pool._endTimeStamp = isNaN(endTime.getTime()) ? 0 : endTime.getTime();
            }
            else {
                pool._endTimeStamp = 0;
            }
        });
        data.sort((a, b) => (a._endTimeStamp || 0) - (b._endTimeStamp || 0));
        for (let i = 0; i < data.length; i++) {
            const pool = data[i];
            if (pool.timer.startsWith('公测开启后')) {
                pool.startTime = '2024/07/04 10:00:00';
                const parts = pool.timer.split('~');
                const endPart = parts[1].trim();
                pool.endTime = endPart;
                pool.timer = `${pool.startTime} ~ ${pool.endTime}`;
            }
            else if (pool.timer.includes('版本更新后')) {
                const parts = pool.timer.split('~');
                const endPart = parts[1].trim();
                let prevEndTime = 0;
                for (let j = i - 1; j >= 0; j--) {
                    const prev = data[j];
                    if ((prev._endTimeStamp || 0) > 0 && (prev._endTimeStamp || 0) < (pool._endTimeStamp || 0)) {
                        prevEndTime = prev._endTimeStamp || 0;
                        break;
                    }
                }
                if (!prevEndTime) {
                    throw new Error(`无法根据“版本更新后”计算卡池起始时间，数据异常：${JSON.stringify(pool)}`);
                }
                const d = new Date(prevEndTime);
                d.setDate(d.getDate() + 1);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                pool.startTime = `${year}/${month}/${day} 11:00:00`;
                pool.endTime = endPart;
                pool.timer = `${pool.startTime} ~ ${pool.endTime}`;
            }
            else {
                const [start, end] = pool.timer.split('~').map(s => s.trim());
                pool.startTime = start;
                pool.endTime = end;
            }
        }
        return data;
    }
}
//# sourceMappingURL=poolHistory.js.map