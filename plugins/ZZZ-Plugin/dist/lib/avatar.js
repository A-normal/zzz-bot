import { ZZZAvatarBasic, ZZZAvatarInfo } from '../model/avatar.js';
import { getPanelData, savePanelData } from './db.js';
import settings from './settings.js';
import { char } from './convert.js';
import _ from 'lodash';

export async function getAvatarBasicList(api, deviceFp, origin = false) {
    const avatarBaseListData = await api.getFinalData('zzzAvatarList', {
        deviceFp,
    });
    if (!avatarBaseListData)
        return null;
    if (origin)
        return avatarBaseListData.avatar_list;
    const result = avatarBaseListData.avatar_list.map(item => new ZZZAvatarBasic(item));
    return result;
}

export async function getAvatarSingleInfo(api, deviceFp, charId) {
    const data = await api.getFinalData('zzzAvatarInfo', {
        deviceFp,
        query: {
            id_list: [charId],
        },
    });
    if (!data || !data.avatar_list || data.avatar_list.length === 0)
        return null;
    return data.avatar_list[0];
}

export async function getAvatarInfoList(api, deviceFp, origin = false) {
    const avatarBaseList = await getAvatarBasicList(api, deviceFp, origin);
    if (!avatarBaseList)
        return null;
    const avatarInfoList = [];
    for (const item of avatarBaseList) {
        const data = await api.getFinalData('zzzAvatarInfo', {
            deviceFp,
            query: {
                id_list: [item.id],
            },
        });
        if (!data || !data.avatar_list || data.avatar_list.length === 0)
            continue;
        avatarInfoList.push(data.avatar_list[0]);
        const time = _.get(settings.getConfig('panel'), 'roleInterval', 300);
        let refresh;
        if (time > 50) {
            refresh = time;
        }
        else {
            refresh = 50;
        }
        await new Promise(resolve => setTimeout(resolve, refresh));
    }
    if (!avatarInfoList?.length)
        return null;
    if (origin)
        return avatarInfoList;
    const result = avatarInfoList.map(item => new ZZZAvatarInfo(item));
    return result;
}

export const updatePanelData = (uid, newData) => {
    const originData = getPanelData(uid);
    const finalData = [...newData];
    if (originData) {
        for (const item of originData) {
            if (!finalData.find(i => i.id === item.id)) {
                finalData.push(item);
            }
        }
    }
    savePanelData(uid, finalData);
    finalData.forEach(item => {
        item.isNew = newData.some(i => i.id === item.id);
    });
    return finalData;
};

export const refreshPanel = async (api, deviceFp) => {
    const newData = await getAvatarInfoList(api, deviceFp, true);
    if (!newData)
        return null;
    return mergePanel(api.uid, newData);
};

export const mergePanel = async (uid, newData) => {
    const finalData = updatePanelData(uid, newData);
    const formattedData = finalData.map(item => new ZZZAvatarInfo(item));
    for (const item of formattedData) {
        await item.get_basic_assets();
    }
    return formattedData;
};

export const getPanelList = (uid) => {
    const data = getPanelData(uid);
    return data.map(item => new ZZZAvatarInfo(item));
};

export const getPanelListOrigin = (uid) => {
    return getPanelData(uid);
};

export const getPanelOrigin = (uid, name) => {
    let id = char.aliasToId(name);
    const data = getPanelData(uid) || [];
    let result = id ? data.find(item => item.id === id) : null;
    
    // 如果没有查到结果（ID未知或该ID在用户数据中未匹配），进行自解释推导
    if (!result && data.length > 0 && name) {
        const cleanName = String(name).trim();
        const found = data.find(item => {
            const n1 = item.name_mi18n || '';
            const n2 = item.full_name_mi18n || '';
            const n3 = item.name || '';
            return n1 === cleanName || n2 === cleanName || n3 === cleanName ||
                   (n2 && n2.includes(cleanName)) || (cleanName.length >= 2 && n1.includes(cleanName));
        });
        if (found) {
            result = found;
            id = found.id;
            // 逆向推导出结果，立即更新本地动态字典
            if (typeof char.registerDynamicPartner === 'function') {
                char.registerDynamicPartner(id, {
                    id,
                    name: found.name_mi18n || found.name || cleanName,
                    full_name: found.full_name_mi18n || found.name_mi18n || cleanName,
                    rarity: found.rarity || 'S'
                });
            }
        }
    }
    if (!result) {
        return id ? null : false;
    }
    return result;
};

export const getPanel = (uid, name) => {
    const raw = getPanelOrigin(uid, name);
    if (raw === false || raw === null) return raw;
    return new ZZZAvatarInfo(raw);
};

export const formatPanelDatas = (data) => {
    return data.map(item => new ZZZAvatarInfo(item));
};

export const formatPanelData = (data) => {
    return new ZZZAvatarInfo(data);
};
