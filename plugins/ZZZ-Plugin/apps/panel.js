import { mergePanel, getPanelList, refreshPanel as refreshPanelFunction, getPanelOrigin, updatePanelData, formatPanelData, getPanelListOrigin, } from '../lib/avatar.js';
import { parsePlayerInfo, refreshPanelFromEnka } from '../model/Enka/enkaApi.js';
import { rulePrefix } from '../lib/common.js';
import { ZZZPlugin } from '../lib/plugin.js';
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
                    reg: `${rulePrefix}(.*)面板(展柜)?(刷新|更新|列表)?$`,
                    fnc: 'handleRule'
                },
                {
                    reg: `${rulePrefix}练度(统计)?$`,
                    fnc: 'proficiency'
                },
                {
                    reg: `${rulePrefix}原图$`,
                    fnc: 'getCharOriImage'
                },
                {
                    reg: `${rulePrefix}(?:(.*)换装|换装(.*))$`,
                    fnc: 'customSkinHelp'
                }
            ],
            handler: [
                { key: 'zzz.tool.panel', fn: 'getCharPanelTool' },
                { key: 'zzz.tool.panelList', fn: 'getCharPanelListTool' }
            ]
        });
    }
    async handleRule() {
        if (!this.e.msg)
            return;
        const reg = new RegExp(`${rulePrefix}(.*?)(?:展柜)?面板(?:展柜)?(刷新|更新|列表)?$`);
        const match = this.e.msg.match(reg);
        if (!match)
            return false;
        const pre = match[4]?.trim();
        const suf = match[5]?.trim();
        if (['刷新', '更新'].includes(pre || '') || ['刷新', '更新'].includes(suf || ''))
            return await this.refreshPanel();
        if (!pre || suf === '列表')
            return await this.getCharPanelList();
        const queryPanelReg = new RegExp(`${rulePrefix}(.*)面板$`);
        if (queryPanelReg.test(this.e.msg))
            return await this.getCharPanel();
        return false;
    }
    async refreshPanel() {
        const uid = await this.getUID();
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
        const isEnka = this.e.msg.includes('展柜') || !(await getCk(this.e));
        let result = null;
        let progressRes = null;
        if (isEnka) {
            const data = await refreshPanelFromEnka(uid)
                .catch(err => err);
            if (data instanceof Error) {
                logger.warn(`Enka服务调用失败：`, data);
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
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                const { playerInfo, panelList } = data;
                if (!panelList.length) {
                    const emptyTip = [
                        '【绝区零展柜面板提示】',
                        '⚠️ 未在 Enka 展柜中检测到公开展示的代理人。',
                        '💡 设置指引：',
                        '1. 登录绝区零游戏，点击左上角「绳匠名片」；',
                        '2. 点击「展柜设置」，将您的主力代理人放入展柜；',
                        '3. 确保右上角的「公开展示角色详情」处于开启勾选状态；',
                        '4. 完成后等待 1~2 分钟游戏数据同步，重新发送 /更新面板 即可展示。'
                    ].join('\n');
                    return this.reply(emptyTip);
                }
                result = await mergePanel(uid, panelList);
                await this.getPlayerInfo(playerInfo);
            }
            else if (typeof data === 'number') {
                const codeTip = [
                    '【绝区零展柜面板提示】',
                    `⚠️ Enka服务返回状态码：${data}`,
                    '💡 说明：通常为 Enka 接口临时限频或正在拉取数据，请稍候 2 分钟后再试。'
                ].join('\n');
                return this.reply(codeTip);
            }
        }
        else {
            const oriReply = this.reply.bind(this);
            let errorMsg = '';
            this.reply = (msg) => {
                errorMsg += '\n' + msg;
                return Promise.resolve(null);
            };
            try {
                const { api, deviceFp } = await this.getAPI();
                progressRes = await oriReply('正在更新面板列表，请稍候...', false, { recallMsg: 120 });
                await this.getPlayerInfo();
                await redis.set(`ZZZ:PANEL:${uid}:LASTTIME`, Date.now());
                result = await refreshPanelFunction(api, deviceFp);
            }
            catch (err) {
                logger.error('面板列表更新失败：', err);
                errorMsg = (err.message || '') + errorMsg;
            }
            this.reply = oriReply;
            if (errorMsg && !result) {
                if (progressRes?.message_id) {
                    if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
                    else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
                }
                const failTip = [
                    '【绝区零面板更新失败】',
                    `原因：${errorMsg.trim()}`,
                    '💡 建议：可稍后再试，或尝试发送 /更新展柜面板 通过 Enka 展柜刷新；若凭据失效请发送 /绑定 重新扫码。'
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
        if (progressRes?.message_id) {
            if (this.e.group?.recallMsg) await this.e.group.recallMsg(progressRes.message_id).catch(() => {});
            else if (this.e.recallMsg) await this.e.recallMsg(progressRes.message_id).catch(() => {});
        }
    }
    async getCharPanelList() {
        const uid = await this.getUID();
        const result = getPanelList(uid);
        if (!result.length) {
            return this.reply(`UID:${uid}暂无本地面板数据，请先发送 /更新面板 或 %更新面板 获取`);
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
        const reg = new RegExp(`${rulePrefix}(.+)面板$`);
        const match = this.e.msg.match(reg);
        if (!match)
            return false;
        const name = match[4];
        const data = getPanelOrigin(uid, name);
        if (data === false) {
            return this.reply(`角色${name}不存在，请确保角色名称/别称存在`);
        }
        else if (data === null) {
            return this.reply(`暂无角色${name}面板数据，请先%更新面板`);
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
            return this.reply('未找到面板数据，请先%更新面板 或 %更新展柜面板');
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
//# sourceMappingURL=panel.js.map