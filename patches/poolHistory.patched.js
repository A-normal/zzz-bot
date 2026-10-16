import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { aliasToName } from '../lib/convert/char.js';
import common from '../../../../lib/common/common.js';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
import settings from '../lib/settings.js';
import fetch from 'node-fetch';
const require = createRequire(import.meta.url);
const DATA_URLS = [
    'https://ghproxy.net/https://raw.githubusercontent.com/iaoongin/GachaClock/main/spider/data/zzz/history.json',
    'https://raw.githubusercontent.com/iaoongin/GachaClock/main/spider/data/zzz/history.json'
];

function getCheerio() {
    const pnpmPath = path.resolve(process.cwd(), 'node_modules/.pnpm');
    if (fs.existsSync(pnpmPath)) {
        try {
            const entries = fs.readdirSync(pnpmPath).filter(x => x.startsWith('cheerio@'));
            if (entries.length) {
                return require(path.resolve(pnpmPath, entries[0], 'node_modules/cheerio'));
            }
        } catch {}
    }
    try {
        return require('cheerio');
    } catch {
        return null;
    }
}

async function fetchBiliWiki() {
    const cheerio = getCheerio();
    if (!cheerio) return null;
    const apiUrl = 'https://wiki.biligame.com/zzz/api.php?action=parse&page=%E8%B0%83%E9%A2%91&prop=text&format=json';
    const res = await fetch(apiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
            'Referer': 'https://wiki.biligame.com/zzz/',
            'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const html = json?.parse?.text?.['*'];
    if (!html) return null;
    const $ = cheerio.load(html);
    const seen = new Set();
    const items = [];
    $('table').each((_, tb) => {
        const $tb = $(tb);
        if ($tb.find('table').length > 0) return;
        const trs = $tb.find('tr');
        if (trs.length < 3) return;
        let timeText = null;
        let versionText = null;
        let sList = [];
        let aList = [];
        let titleText = '';
        let imgSrc = '';
        trs.each((idx, tr) => {
            const $tr = $(tr);
            const th = $tr.find('th').text().trim();
            const td = $tr.find('td');
            const tdText = td.text().trim();
            if (idx === 0) {
                titleText = $tr.text().trim().replace(/\n/g, '');
                const img = $tr.find('img');
                if (img.length) {
                    imgSrc = img.attr('srcset')?.split(' ')[0] || img.attr('src') || '';
                }
            }
            if (th.includes('时间')) {
                timeText = tdText;
            } else if (th.includes('版本')) {
                versionText = tdText;
            } else if (th.includes('S级') || th.includes('S 级')) {
                td.find('a').each((_, a) => {
                    const name = $(a).attr('title') || $(a).text().trim();
                    if (name) sList.push(name);
                });
            } else if (th.includes('A级') || th.includes('A 级')) {
                td.find('a').each((_, a) => {
                    const name = $(a).attr('title') || $(a).text().trim();
                    if (name) aList.push(name);
                });
            }
        });
        if (timeText && versionText && sList.length > 0) {
            const isRole = titleText.includes('独家') || $tb.text().includes('代理人');
            const type = isRole ? '角色' : '武器';
            const cleanA = Array.from(new Set(aList.map(x => x.replace(/（.*）/, '').trim()))).sort();
            for (const s of sList) {
                const cleanS = s.replace(/（.*）/, '').trim();
                const key = `${versionText}_${type}_${cleanS}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const defaultImg = isRole
                    ? 'https://patchwiki.biligame.com/images/zzz/thumb/7/7f/8pesvtvchbs3t2jhqjhckd9k08pe7ui.png/900px-%E7%8B%AC%E5%AE%B6%E9%A2%91%E6%AE%B5001%E6%9C%9F.png'
                    : 'https://patchwiki.biligame.com/images/zzz/thumb/3/32/gs2uajlo6v2h6pljzij84wdiwhu9fkj.png/900px-%E9%9F%B3%E6%93%8E%E9%A2%91%E6%AE%B5001%E6%9C%9F.png';
                items.push({
                    img: imgSrc || defaultImg,
                    title: titleText || `「${cleanS}」频段`,
                    type,
                    version: versionText,
                    timer: timeText,
                    s: cleanS,
                    a: cleanA,
                    img_path: `img/zzz/history/${titleText || cleanS}.png`
                });
            }
        }
    });
    return items.length > 0 ? items : null;
}
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
                    reg: `${rulePrefix}(刷新|更新|重载)卡池(记录|历史)?$`,
                    fnc: 'reloadPoolData'
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
                    reg: `${rulePrefix}(?!刷新|更新|重载).+(复刻|卡池)(统计|记录|历史)$`,
                    fnc: 'dispatchHandler'
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
                const aRoles = Array.isArray(p.a) ? p.a.join('，') : (p.a || '');
                replyMsg.push(`◈ S-${p.s}${aRoles ? ' | A-' + aRoles : ''}\n`);
                replyMsg.push(segment.image(p.img));
            });
        }
        if (weaponPools.length > 0) {
            replyMsg.push(`\n【 音擎调频 】\n`);
            weaponPools.forEach(p => {
                const aWeapons = Array.isArray(p.a) ? p.a.join('，') : (p.a || '');
                replyMsg.push(`◈ S-${p.s}${aWeapons ? ' | A-' + aWeapons : ''}\n`);
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
                        await redis.del(this.queryAllPoolMsgCacheKey);
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
                    await redis.del(this.queryAllPoolMsgCacheKey);
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
                    const aRoles = Array.isArray(p.a) ? p.a.join('，') : (p.a || '');
                    replyMsg.push(`◈ 角色：S-${p.s}${aRoles ? ' | A-' + aRoles : ''}\n`);
                    replyMsg.push(segment.image(p.img));
                }
            }
            if (weaponPools.length > 0) {
                for (const p of weaponPools) {
                    const aWeapons = Array.isArray(p.a) ? p.a.join('，') : (p.a || '');
                    replyMsg.push(`◈ 音擎：S-${p.s}${aWeapons ? ' | A-' + aWeapons : ''}\n`);
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
            const latest = data[data.length - 1];
            return this.reply(`【绝区零卡池记录】\n✅ 已从远端同步最新卡池！\n共收录 ${data.length} 条记录，最新版本：${latest?.version || '未知'}`);
        } else {
            return this.reply('❌ 刷新卡池数据失败，请检查日志。');
        }
    }
    async fetchFromRemote() {
        try {
            const biliData = await fetchBiliWiki();
            if (Array.isArray(biliData) && biliData.length > 0) {
                return biliData;
            }
        } catch (e) {
            logger.warn(`[ZZZ-Plugin] B站Wiki卡池接口获取异常: ${e.message}，尝试备选源`);
        }
        for (const url of DATA_URLS) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Cache-Control': 'no-cache' },
                    signal: AbortSignal.timeout(5000)
                });
                if (response.ok) {
                    const parsed = await response.json();
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed;
                    }
                }
            } catch (err) {
                logger.warn(`[ZZZ-Plugin] 备选卡池数据源 ${url} 获取失败: ${err.message}`);
            }
        }
        return null;
    }
    async fetchData(forceReload = false) {
        if (!forceReload) {
            const cacheValid = await redis.get(this.dataCacheExpireKey);
            if (cacheValid) {
                const cache = await redis.get(this.dataCacheKey);
                if (cache) {
                    try {
                        const parsedCache = JSON.parse(cache);
                        if (Array.isArray(parsedCache) && parsedCache.length > 0) {
                            return parsedCache;
                        }
                    } catch {}
                    await redis.del(this.dataCacheExpireKey);
                    await redis.del(this.dataCacheKey);
                    await redis.del(this.queryAllPoolMsgCacheKey);
                }
            }
        }
        const localPath = './plugins/ZZZ-Plugin/resources/history.json';
        let rawData = null;
        // 1. 优先从高可用远端源拉取（B站MediaWiki实时API -> 备选GitHub CDN）
        rawData = await this.fetchFromRemote();
        if (rawData && Array.isArray(rawData) && rawData.length > 0) {
            // 远端拉取成功，自动同步覆盖本地文件作为紧急离线后备镜像
            try {
                fs.writeFileSync(localPath, JSON.stringify(rawData, null, 2), 'utf8');
            } catch (e) {
                logger.warn(`[ZZZ-Plugin] 同步本地离线卡池缓存失败: ${e.message}`);
            }
        } else {
            // 2. 远端全部不可用时，降级使用本地离线镜像
            logger.warn('[ZZZ-Plugin] 远端卡池源获取均未成功，降级读取本地离线数据');
            if (fs.existsSync(localPath)) {
                try {
                    const localContent = fs.readFileSync(localPath, 'utf8');
                    const parsed = JSON.parse(localContent);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        rawData = parsed;
                    }
                } catch (e) {
                    logger.error(`[ZZZ-Plugin] 读取本地离线卡池文件失败: ${e.message}`);
                }
            }
        }
        // 3. 兜底旧缓存
        if (!rawData) {
            const cache = await redis.get(this.dataCacheKey);
            if (cache) {
                return JSON.parse(cache);
            }
            logger.error('[ZZZ-Plugin] 卡池历史数据获取失败: 远端与本地后备均不可用');
            return null;
        }
        const data = this.processData(rawData);
        if (data) {
            await redis.set(this.dataCacheExpireKey, '1', {
                EX: 24 * 60 * 60
            });
            await redis.set(this.dataCacheKey, JSON.stringify(data));
            await redis.del(this.queryAllPoolMsgCacheKey);
            return data;
        }
        return null;
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