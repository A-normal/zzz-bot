import settings from '../settings.js';
import { getMapData } from '../../utils/file.js';
import { dataPath } from '../path.js';
import path from 'path';
import fs from 'fs';

const PartnerId2Data = getMapData('PartnerId2Data') || {};

const dynamicFile = path.join(dataPath, 'dynamic_partners.json');
let dynamicPartnerMap = {};

function loadDynamicPartners() {
    try {
        if (fs.existsSync(dynamicFile)) {
            const raw = fs.readFileSync(dynamicFile, 'utf8');
            dynamicPartnerMap = JSON.parse(raw);
        }
    } catch (e) {
        // ignore load error
    }
}

function saveDynamicPartners() {
    try {
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        fs.writeFileSync(dynamicFile, JSON.stringify(dynamicPartnerMap, null, 2), 'utf8');
    } catch (e) {
        // ignore save error
    }
}

loadDynamicPartners();

export const registerDynamicPartner = (id, info = {}) => {
    if (!id) return;
    const key = String(id);
    const existing = dynamicPartnerMap[key] || {};
    const name = info.name || info.zh || info.name_mi18n || existing.name || '';
    const full_name = info.full_name || info.full_name_mi18n || name || existing.full_name || '';
    const en_name = info.en_name || info.en || info.code || existing.en_name || '';
    dynamicPartnerMap[key] = {
        ...existing,
        ...info,
        id: Number(id),
        name,
        full_name,
        en_name,
    };
    saveDynamicPartners();
    if (global.logger?.mark) {
        global.logger.mark(`[ZZZ-Plugin] 注册/学习动态代理人元数据: ID=${id}, 名称=${name}`);
    }
};

export const syncFromNanoka = async () => {
    try {
        const manifestRes = await fetch('https://static.nanoka.cc/manifest.json', {
            signal: AbortSignal.timeout(4000)
        });
        let v = '3.3';
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            v = manifest?.zzz?.latest || v;
        }
        const charRes = await fetch(`https://static.nanoka.cc/zzz/${v}/character.json`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!charRes.ok) return;
        const charList = await charRes.json();
        let changed = false;
        for (const [id, c] of Object.entries(charList)) {
            if (!PartnerId2Data?.[id] && c?.zh) {
                if (!dynamicPartnerMap[id] || dynamicPartnerMap[id].name !== c.zh) {
                    dynamicPartnerMap[id] = {
                        id: Number(id),
                        name: c.zh,
                        full_name: c.zh,
                        en_name: c.en || c.code || '',
                        code: c.code,
                        element: c.element,
                        camp: c.camp,
                        source: 'nanoka'
                    };
                    changed = true;
                }
            }
        }
        if (changed) {
            saveDynamicPartners();
            if (global.logger?.mark) {
                global.logger.mark(`[ZZZ-Plugin] 已从 Nanoka 远端同步补齐 ${Object.keys(dynamicPartnerMap).length} 个动态代理人元数据`);
            }
        }
    } catch (e) {
        // background sync failure is non-fatal
    }
};

// 启动后延迟 3 秒尝试异步后台拉取远端元数据
setTimeout(() => {
    syncFromNanoka().catch(() => {});
}, 3000);

export const idToName = (id, full = true, en = false) => {
    const data = PartnerId2Data?.[id] || dynamicPartnerMap?.[id];
    if (!data)
        return null;
    if (en)
        return data?.['en_name'];
    if (full)
        return data?.['full_name'] || data?.['name'];
    return data?.['name'];
};

export const idToSprite = (id) => {
    const data = PartnerId2Data?.[id] || dynamicPartnerMap?.[id];
    if (!data)
        return null;
    return data?.['sprite_id'] || data?.['icon'];
};

export const idToData = (id) => {
    return PartnerId2Data[id] || dynamicPartnerMap[id] || null;
};

export const nameToId = (name) => {
    if (!name) return null;
    for (const [id, data] of Object.entries(PartnerId2Data)) {
        if (data['name'] === name)
            return Number(id);
        if (data['full_name'] && data['full_name'] === name)
            return Number(id);
    }
    for (const [id, data] of Object.entries(dynamicPartnerMap)) {
        if (data['name'] === name || data['full_name'] === name)
            return Number(id);
    }
    return null;
};

export const nameToSprite = (name) => {
    for (const [_id, data] of Object.entries(PartnerId2Data)) {
        if (data['name'] === name)
            return data['sprite_id'];
    }
    for (const [_id, data] of Object.entries(dynamicPartnerMap)) {
        if (data['name'] === name)
            return data['sprite_id'] || data['icon'];
    }
    return null;
};

export const aliasToName = (_alias) => {
    if (!_alias) return null;
    const alias = settings.getConfig('alias') || {};
    for (const [name, data] of Object.entries(alias)) {
        if (name === _alias)
            return name;
        if (Array.isArray(data) && data.includes(_alias))
            return name;
    }
    for (const [_, data] of Object.entries(PartnerId2Data)) {
        if (data['name'] === _alias)
            return data['name'];
        if (data['full_name'] && data['full_name'] === _alias)
            return data['name'];
    }
    for (const [_, data] of Object.entries(dynamicPartnerMap)) {
        if (data['name'] === _alias || data['full_name'] === _alias)
            return data['name'];
    }
    return null;
};

export const aliasToSprite = (_alias) => {
    const name = aliasToName(_alias);
    return nameToSprite(name);
};

export const aliasToId = (name) => {
    if (!name) return null;
    const _name = aliasToName(name);
    if (_name) {
        const id = nameToId(_name);
        if (id) return id;
    }
    return nameToId(name);
};

export const getAllCharactersID = () => {
    const allIds = new Set([
        ...Object.keys(PartnerId2Data).filter(id => id !== '2011' && id !== '2021'),
        ...Object.keys(dynamicPartnerMap)
    ]);
    return Array.from(allIds);
};

export const skinIdToFilename = (id, skin_id) => {
    const data = PartnerId2Data?.[id] || dynamicPartnerMap?.[id];
    if (!data)
        return null;
    const skinData = data.Skin;
    return skinData?.[skin_id]?.Image || null;
};
