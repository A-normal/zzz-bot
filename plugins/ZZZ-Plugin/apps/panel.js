import { mergePanel, getPanelList, refreshPanel as refreshPanelFunction, getPanelOrigin, updatePanelData, formatPanelData, getPanelListOrigin, getAvatarSingleInfo } from '../lib/avatar.js';
import { getPanelData } from '../lib/db.js';
import { parsePlayerInfo, refreshPanelFromEnka } from '../model/Enka/enkaApi.js';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
import { char } from '../lib/convert.js';
import settings from '../lib/settings.js';
import { getCk } from '../lib/common.js';
import _ from 'lodash';

export class Panel extends ZZZPlugin {
    constructor() {
        super({
            name: '[ZZZ-Plugin]Panel',
            dsc: 'zzzpanel',
            event: 'message',
            priority: _.get(settings.getConfig('priority'), 'panel', 70),
            rule: [
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?(更新展柜|刷新展柜|展柜更新|展柜刷新|更新展柜面板)$',
                    fnc: 'handleShowcaseUpdate'
                },
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?(更新面板|刷新面板)(?:\\s+.+)?$',
                    fnc: 'handlePanelUpdate'
                },
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?(.*)面板(展柜)?(列表)?$',
                    fnc: 'handleRule'
                },
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?练度(统计)?$',
                    fnc: 'proficiency'
                },
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?原图$',
                    fnc: 'getCharOriImage'
                },
                {
                    reg: '^[#%/]?(?:zzz|ZZZ|绝区零)?(?:(.*)换装|换装(.*))$',
                    fnc: 'customSkinHelp'
                }
            ],
            handler: [
                { key: 'zzz.tool.panel', fn: 'getCharPanelTool' },
                { key: 'zzz.tool.panelList', fn: 'getCharPanelListTool' }
            ]
        });
    }

    /**
     * 1. 专门更新展柜：#更新展柜 / #刷新展柜 / #更新展柜面板
     */
    async handleShowcaseUpdate() {
        return await this.refreshShowcase();
    }

    /**
     * 2. 更新面板指令：
     *    - 带参数：#更新面板 <角色名> -> 仅更新单角色面板
     *    - 无参数：#更新面板 -> 首次提示风险与推荐方式，5分钟内二次发送才执行全量更新
     */
    async handlePanelUpdate() {
        if (!this.e.msg)
            return false;
        const raw = this.e.msg.trim();
        const roleMatch = raw.match(/^[#%/]?(?:zzz|ZZZ|绝区零)?(?:更新面板|刷新面板)(?:\s+(.+))?$/i);
        const roleArg = roleMatch?.[1]?.trim();

        if (roleArg) {
            return await this.refreshSinglePanel(roleArg);
        }

        // 无参数：五分钟内确认机制
        const uid = await this.getUID();
        if (!uid) return false;
        const confirmKey = `ZZZ:PANEL:CONFIRM:${uid}`;
        const isConfirmed = await redis.get(confirmKey);

        if (!isConfirmed) {
            await redis.set(confirmKey, '1', { EX: 300 }); // 5分钟有效
            const warnTip = [
                '【绝区零面板更新提示】',
                '⚠️ 全量更新名下所有代理人需逐个请求，耗时较长且极易触发米游社账号风控（10041/验证码）。',
                '',
                '💡 推荐更快速安全的更新方式：',
                '1. 发送【#更新展柜】：秒级同步游戏名片公开的代理人（推荐，无风控）；',
                '2. 发送【#更新面板 角色名】：如「#更新面板 艾莲」，仅更新指定角色（秒级同步）。',
                '',
                '📌 若确需全量同步所有仓库代理人，请在 5 分钟内再次发送【#更新面板】确认执行。'
            ].join('\n');
            return this.reply(warnTip);
        }

        // 二次确认，清除标记，执行全量方案
        await redis.del(confirmKey);
        return await this.refreshBulkPanel();
    }

    /**
     * 单角色面板更新（针对性单请求，快速防风控）
     */
    async refreshSinglePanel(charName) {
        const uid = await this.getUID();
        if (!uid) return false;

        // 解析角色 ID（三层降级解析：静态字典 -> 动态字典 -> 用户本地自解释推导）
        let id = char.aliasToId(charName);
        if (!id) {
            const localData = getPanelData(uid) || [];
            const found = localData.find(item => {
                const n1 = item.name_mi18n || '';
                const n2 = item.full_name_mi18n || '';
                const n3 = item.name || '';
                return n1 === charName || n2 === charName || n3 === charName ||
                       (n2 && n2.includes(charName)) || (charName.length >= 2 && n1.includes(charName));
            });
            if (found) {
                id = found.id;
                if (typeof char.registerDynamicPartner === 'function') {
                    char.registerDynamicPartner(id, {
                        id,
                        name: found.name_mi18n || found.name || charName,
                        full_name: found.full_name_mi18n || found.name_mi18n || charName,
                        rarity: found.rarity || 'S'
                    });
                }
            }
        }

        if (!id) {
            return this.reply(`未找到代理人【${charName}】，请确保角色名称或别名正确`);
        }

        const realName = char.idToName(id) || charName;
        const hasCk = !!(await getCk(this.e));
        let singleData = null;
        let errorMsg = '';
        let progressRes = null;

        if (hasCk) {
            progressRes = await this.reply(`正在从米游社更新【${realName}】面板，请稍候...`, false, { recallMsg: 60 });
            try {
                const { api, deviceFp } = await this.getAPI();
                singleData = await getAvatarSingleInfo(api, deviceFp, id);
            }
            catch (err) {
                logger.error(`单角色【${realName}】米游社更新失败:`, err);
                errorMsg = err.message || '';
            }

            if (singleData) {
                if (progressRes?.message_id) {
                    if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                    else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                }
                updatePanelData(uid, [singleData]);
                return await this.getCharPanelTool(this.e, { uid, data: singleData, needSave: false });
            }

            // 米游社受限，自动尝试 Enka 展柜降级
            logger.mark(`[ZZZ-Plugin] 【${realName}】米游社更新受限，尝试 Enka 展柜同步`);
            const enkaData = await refreshPanelFromEnka(uid).catch(err => err);
            if (typeof enkaData === 'object' && enkaData?.panelList?.length) {
                const enkaRole = enkaData.panelList.find(p => p.id === id);
                if (enkaRole) {
                    if (progressRes?.message_id) {
                        if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                        else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                    }
                    updatePanelData(uid, [enkaRole]);
                    await this.getCharPanelTool(this.e, { uid, data: enkaRole, needSave: false });
                    return await this.reply(`⚠️ 米游社查询受限（${errorMsg.trim()}），已自动从 Enka 展柜同步【${realName}】面板！`);
                }
            }

            if (progressRes?.message_id) {
                if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
            }

            const failTip = [
                `【绝区零代理人【${realName}】面板更新提示】`,
                `⚠️ 米游社接口查询受限：${errorMsg.trim() || '未获取到数据'}`,
                `⚠️ 且游戏内名片展柜未公开展示【${realName}】`,
                `💡 建议：可登录绝区零将【${realName}】放入名片展柜并公开详情，然后发送「#更新展柜」同步。`
            ].join('\n');
            return this.reply(failTip);
        }
        else {
            // 未绑定 Cookie，直接通过 Enka 展柜查询
            const enkaData = await refreshPanelFromEnka(uid).catch(err => err);
            if (typeof enkaData === 'object' && enkaData?.panelList?.length) {
                const enkaRole = enkaData.panelList.find(p => p.id === id);
                if (enkaRole) {
                    updatePanelData(uid, [enkaRole]);
                    return await this.getCharPanelTool(this.e, { uid, data: enkaRole, needSave: false });
                }
            }

            const unbindTip = [
                `【绝区零代理人【${realName}】面板更新提示】`,
                `⚠️ 当前未绑定米游社，且游戏内名片展柜中未检测到【${realName}】。`,
                `💡 解决建议：`,
                `1. 登录游戏点击名片 -> 展柜设置，将【${realName}】放入展柜并开启公开展示，随后发送「#更新展柜」；`,
                `2. 或发送「#绑定」扫码绑定米游社凭据。`
            ].join('\n');
            return this.reply(unbindTip);
        }
    }

    /**
     * 展柜更新核心流程（1次请求，秒级完成，零风控）
     */
    async refreshShowcase() {
        const uid = await this.getUID();
        if (!uid) return false;

        const lastQueryTime = await redis.get(`ZZZ:PANEL:${uid}:LASTTIME`);
        const panelSettings = settings.getConfig('panel');
        const coldTime = _.get(panelSettings, 'interval', 300);
        if (lastQueryTime && Date.now() - Number(lastQueryTime) < 1000 * coldTime) {
            const passed = Math.floor((Date.now() - Number(lastQueryTime)) / 1000);
            const remain = coldTime - passed;
            const m = Math.floor(remain / 60);
            const s = remain % 60;
            const timeDesc = m > 0 ? `${m}分${s}秒` : `${s}秒`;
            return this.reply(`⏳ 刷新展柜冷却中：请在 ${timeDesc} 后再试（避免频繁请求触发风控）`);
        }

        const data = await refreshPanelFromEnka(uid).catch(err => err);
        if (data instanceof Error) {
            logger.warn(`Enka展柜调用失败：`, data);
            const errTip = [
                '【绝区零展柜面板提示】',
                `⚠️ Enka展柜服务查询失败：${data.message}`,
                '💡 排查建议：',
                '1. 请确认当前绑定的绝区零 UID 是否无误；',
                '2. 检查游戏内「绳匠名片」->「展柜设置」中是否开启「公开展示角色详情」；',
                '3. 若刚刚放入角色，请等待 2 分钟待米哈游服务器与 Enka 完成同步后重试。'
            ].join('\n');
            return this.reply(errTip);
        }
        if (typeof data === 'object') {
            const { playerInfo, panelList } = data;
            if (!panelList || !panelList.length) {
                const emptyTip = [
                    '【绝区零展柜面板提示】',
                    '⚠️ 未在 Enka 展柜中检测到公开展示的代理人。',
                    '💡 设置指引：',
                    '1. 登录绝区零游戏，点击左上角「绳匠名片」；',
                    '2. 点击「展柜设置」，将您的主力代理人放入展柜；',
                    '3. 确保右上角的「公开展示角色详情」处于开启勾选状态；',
                    '4. 完成后等待 1~2 分钟游戏数据同步，重新发送 /更新展柜 即可展示。'
                ].join('\n');
                return this.reply(emptyTip);
            }
            await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
            const result = await mergePanel(uid, panelList);
            await this.getPlayerInfo(playerInfo);
            const newChar = result.filter(item => item.isNew);
            const finalData = {
                newChar: newChar.length,
                list: result
            };
            await this.render('panel/refresh.html', finalData);
            return true;
        }
        else if (typeof data === 'number') {
            const codeTip = [
                '【绝区零展柜面板提示】',
                `⚠️ Enka服务返回状态码：${data}`,
                '💡 说明：通常为 Enka 接口临时限频或正在拉取数据，请稍候 2 分钟后再试。'
            ].join('\n');
            return this.reply(codeTip);
        }
        return false;
    }

    /**
     * 全量更新核心流程（米游社全量 -> 自动降级 Enka 展柜）
     */
    async refreshBulkPanel() {
        const uid = await this.getUID();
        if (!uid) return false;

        const lastQueryTime = await redis.get(`ZZZ:PANEL:${uid}:LASTTIME`);
        const panelSettings = settings.getConfig('panel');
        const coldTime = _.get(panelSettings, 'interval', 300);
        if (lastQueryTime && Date.now() - Number(lastQueryTime) < 1000 * coldTime) {
            const passed = Math.floor((Date.now() - Number(lastQueryTime)) / 1000);
            const remain = coldTime - passed;
            const m = Math.floor(remain / 60);
            const s = remain % 60;
            const timeDesc = m > 0 ? `${m}分${s}秒` : `${s}秒`;
            return this.reply(`⏳ 刷新面板冷却中：请在 ${timeDesc} 后再试（避免频繁请求触发风控）`);
        }

        const isEnka = !(await getCk(this.e));
        let result = null;
        let progressRes = null;
        let fallbackNotice = '';

        if (isEnka) {
            return await this.refreshShowcase();
        }

        const oriReply = this.reply.bind(this);
        let errorMsg = '';
        this.reply = (msg) => {
            errorMsg += '\n' + msg;
            return Promise.resolve(null);
        };

        try {
            const { api, deviceFp } = await this.getAPI();
            progressRes = await oriReply('正在全量更新名下代理人列表，请稍候...', false, { recallMsg: 120 });
            await this.getPlayerInfo();
            result = await refreshPanelFunction(api, deviceFp);
            if (result) {
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
            }
        }
        catch (err) {
            logger.error('面板列表全量更新失败：', err);
            errorMsg = (err.message || '') + errorMsg;
        }

        this.reply = oriReply;

        if (!result) {
            logger.mark(`[ZZZ-Plugin] 米游社全量刷新失败(${errorMsg.trim()})，自动尝试 Enka 展柜降级刷新`);
            const enkaData = await refreshPanelFromEnka(uid).catch(err => err);
            if (typeof enkaData === 'object' && enkaData?.panelList?.length) {
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                result = await mergePanel(uid, enkaData.panelList);
                await this.getPlayerInfo(enkaData.playerInfo);
                fallbackNotice = `⚠️ 米游社查询受限（${errorMsg.trim()}），已自动通过 Enka 展柜同步公开角色面板！`;
                logger.mark(`[ZZZ-Plugin] Enka 展柜降级刷新成功，已同步 ${enkaData.panelList.length} 位代理人面板`);
            }
            else if (errorMsg) {
                if (progressRes?.message_id) {
                    if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                    else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                }
                const enkaDetail = typeof enkaData === 'object' && !enkaData?.panelList?.length
                    ? 'Enka展柜：未在展柜中检测到公开展示的代理人（游戏内名片->展柜设置->公开角色详情）'
                    : enkaData instanceof Error
                        ? `Enka展柜降级失败：${enkaData.message}`
                        : '';
                const failTip = [
                    '【绝区零面板全量更新失败】',
                    `米游社错误：${errorMsg.trim()}`,
                    ...(enkaDetail ? [enkaDetail] : []),
                    '💡 建议：可检查游戏内「绳匠名片」->「展柜设置」开启公开展示角色详情；或发送「#更新展柜」同步。'
                ].join('\n');
                return this.reply(failTip);
            }
        }

        if (!result) {
            if (progressRes?.message_id) {
                if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
            }
            return false;
        }

        const newChar = result.filter(item => item.isNew);
        const finalData = {
            newChar: newChar.length,
            list: result
        };
        await this.render('panel/refresh.html', finalData);
        if (fallbackNotice) {
            await this.reply(fallbackNotice);
        }
        if (progressRes?.message_id) {
            if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
            else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
        }
    }

    /**
     * 保持向下兼容的刷新面板方法入口
     */
    async refreshPanel() {
        return await this.handlePanelUpdate();
    }

    async handleRule() {
        if (!this.e.msg)
            return false;
        const raw = this.e.msg.trim();

        if (/^[#%/]?(?:zzz|ZZZ|绝区零)?面板(?:列表)?$/i.test(raw)) {
            return await this.getCharPanelList();
        }

        // 查询角色面板：#艾莲面板、#面板 艾莲、#面板艾莲
        if (/^[#%/]?(?:zzz|ZZZ|绝区零)?(?:.+面板|面板\s*.+)$/i.test(raw)) {
            return await this.getCharPanel();
        }

        return false;
    }

    async getCharPanelList() {
        const uid = await this.getUID();
        const result = getPanelList(uid);
        if (!result.length) {
            return this.reply(`UID:${uid}暂无本地面板数据，请发送【#更新展柜】或【#更新面板 角色名】获取`);
        }
        const hasCk = !!(await getCk(this.e));
        await this.getPlayerInfo(hasCk ? undefined : parsePlayerInfo({ uid }));
        const timer = setTimeout(() => {
            if (this?.reply) {
                this.reply('查询成功，正在下载图片资源，请稍候。');
            }
        }, 5000);
        for (const item of result) {
            await item.get_basic_assets();
        }
        clearTimeout(timer);
        const finalData = {
            count: result?.length || 0,
            list: result
        };
        await this.render('panel/list.html', finalData);
    }

    async getCharPanelListTool(uid, origin = false) {
        if (!uid) {
            return false;
        }
        if (origin) {
            const result = getPanelListOrigin(uid);
            return result;
        }
        const result = getPanelList(uid);
        return result;
    }

    async getCharPanel() {
        const uid = await this.getUID();
        const raw = (this.e.msg || '').trim();
        let name = '';
        const match1 = raw.match(/^[#%/]?(?:zzz|ZZZ|绝区零)?面板\s*(.+)$/i);
        const match2 = raw.match(/^[#%/]?(?:zzz|ZZZ|绝区零)?(.+)面板$/i);

        if (match1) {
            name = match1[1].trim();
        }
        else if (match2) {
            name = match2[1].trim();
        }

        if (!name)
            return false;

        const data = getPanelOrigin(uid, name);
        if (data === false) {
            return this.reply(`角色【${name}】不存在，请确保角色名称或别称正确`);
        }
        else if (data === null) {
            return this.reply(`暂无角色【${name}】面板数据，请发送【#更新面板 ${name}】或【#更新展柜】`);
        }

        const handler = this.e.runtime.handler || {};
        if (handler.has('zzz.tool.panel')) {
            await handler.call('zzz.tool.panel', this.e, {
                uid,
                data: data,
                needSave: false
            });
        }
    }

    async getCharPanelTool(e, _data = {}) {
        if (e)
            this.e = e;
        if (e?.reply)
            this.reply = e.reply;
        const { uid = undefined, data = undefined, needSave = true, reply = true, needImg = true } = _data;
        if (!uid) {
            return this.reply('UID为空');
        }
        if (!data) {
            return this.reply('数据为空');
        }
        if (needSave) {
            updatePanelData(uid, [data]);
        }
        const timer = setTimeout(() => {
            const msg = '查询成功，正在下载图片资源，请稍候。';
            if (this?.reply && needImg) {
                this.reply(msg);
            }
            else {
                logger.mark(msg);
            }
        }, 5000);
        const parsedData = formatPanelData(data);
        await parsedData.get_detail_assets();
        clearTimeout(timer);
        const finalData = {
            uid,
            charData: parsedData
        };
        const image = needImg ? await this.render('panel/card.html', finalData, {
            retType: 'base64'
        }) : needImg;
        if (reply) {
            const res = await this.reply(image);
            if (res?.message_id && parsedData.role_icon)
                await redis.set(`ZZZ:PANEL:IMAGE:${res.message_id}`, parsedData.role_icon, {
                    EX: 3600 * 3
                });
            return {
                message: res,
                image
            };
        }
        return image;
    }

    async proficiency() {
        const uid = await this.getUID();
        const result = getPanelList(uid);
        if (!result) {
            return this.reply('未找到面板数据，请先发送【#更新展柜】或【#更新面板 角色名】');
        }
        await this.getPlayerInfo();
        result.sort((a, b) => {
            return b.proficiency_score - a.proficiency_score;
        });
        const WeaponCount = result.filter(item => item?.weapon).length;
        const SWeaponCount = result.filter(item => item?.weapon && item.weapon.rarity === 'S').length;
        const general = {
            total: result.length,
            SCount: result.filter(item => item.rarity === 'S').length,
            SWeaponRate: (SWeaponCount / WeaponCount) * 100,
            SSSCount: result.reduce((acc, item) => {
                if (item.equip) {
                    acc += item.equip.filter(equip => ['SSS', 'ACE', 'MAX'].includes(String(equip.comment))).length;
                }
                return acc;
            }, 0),
            highRank: result.filter(item => item.rank > 4).length
        };
        const timer = setTimeout(() => {
            if (this?.reply) {
                this.reply('查询成功，正在下载图片资源，请稍候。');
            }
        }, 5000);
        for (const item of result) {
            await item.get_small_basic_assets();
        }
        clearTimeout(timer);
        const finalData = {
            general,
            list: result
        };
        await this.render('proficiency/index.html', finalData);
    }

    async customSkinHelp() {
        const match = this.e.msg.match(new RegExp(`${rulePrefix}(?:(.*)换装|换装(.*))$`));
        const charName = (match?.[4] || match?.[5] || '').trim();
        const tip = [
            '【绝区零角色自定义换装/角色图指引】',
            charName ? `当前查询角色：【${charName}】` : '功能说明：绝区零面板支持自定义角色插画与同人换装',
            '💡 常用指令：',
            '1. 查看已有角色图：%查看' + (charName || '角色名') + '面板图',
            '2. 添加自定义换装：发送图片并附带文字「%添加' + (charName || '角色名') + '面板图」',
            '3. 删除自定义换装：%删除' + (charName || '角色名') + '面板图[ID]',
            '4. 获取原图：回复面板图片并发送「%原图」'
        ].join('\n');
        return await this.reply(tip);
    }

    async getCharOriImage() {
        let source;
        if (this.e.getReply) {
            source = await this.e.getReply();
        }
        else if (this.e.source) {
            if (this.e.group?.getChatHistory) {
                source = (await this.e.group.getChatHistory(this.e.source?.seq, 1)).pop();
            }
            else if (this.e.friend?.getChatHistory) {
                source = (await this.e.friend.getChatHistory(this.e.source?.time + 1, 1)).pop();
            }
        }
        const id = source?.message_id;
        if (!id) {
            return this.reply('未找到消息源，请引用要查看的图片');
        }
        const image = await redis.get(`ZZZ:PANEL:IMAGE:${id}`);
        if (!image) {
            return this.reply('未找到原图');
        }
        await this.reply(segment.image(image));
    }
}
