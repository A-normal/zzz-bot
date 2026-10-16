
file_path = "/home/bjrst/docker/data/zzz-bot/yunzai/plugins/ZZZ-Plugin/dist/apps/poolHistory.js"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Let's find lines from 'async queryAllPool() {' to the end of that method
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if "async queryAllPool() {" in line:
        start_idx = i
    elif start_idx is not None and "async queryVersionPool() {" in line:
        end_idx = i
        break

if start_idx is not None and end_idx is not None:
    new_method = [
        "    async queryAllPool() {\n",
        "        const old = await redis.get(this.queryAllPoolMsgCacheKey);\n",
        "        if (old) {\n",
        "            try {\n",
        "                if (old.startsWith('{') || old.startsWith('[')) {\n",
        "                    redis.del(this.queryAllPoolMsgCacheKey);\n",
        "                } else {\n",
        "                    return await this.reply(old);\n",
        "                }\n",
        "            } catch {\n",
        "                redis.del(this.queryAllPoolMsgCacheKey);\n",
        "            }\n",
        "        }\n",
        "        const data = await this.fetchData();\n",
        "        if (!data)\n",
        "            return this.reply('卡池历史记录数据获取失败');\n",
        "        const versionList = [...new Set(data.map(p => p.version.replace(/(上半|下半)$/u, '')))];\n",
        "        const reversedVersions = [...versionList].reverse();\n",
        "        const lines = ['【 绝区零全版本卡池记录（时间线逆序）】\\n'];\n",
        "        for (const v of reversedVersions) {\n",
        "            const pools = data.filter(p => p.version.startsWith(v));\n",
        "            if (!pools.length)\n",
        "                continue;\n",
        "            const versionStages = [...new Set(pools.map(p => p.version))].sort((a, b) => {\n",
        "                if (a.includes('下半') && b.includes('上半'))\n",
        "                    return -1;\n",
        "                if (a.includes('上半') && b.includes('下半'))\n",
        "                    return 1;\n",
        "                return b.localeCompare(a);\n",
        "            });\n",
        "            for (const stage of versionStages) {\n",
        "                const stagePools = pools.filter(p => p.version === stage);\n",
        "                const timerDisplay = stagePools[0]?.timer?.replace(/ \\d{2}:\\d{2}:\\d{2}/g, '').trim() || '';\n",
        "                lines.push(`【 v${stage} 】${timerDisplay ? ' ' + timerDisplay : ''}`);\n",
        "                const rolePools = stagePools.filter(p => p.type === '角色');\n",
        "                const weaponPools = stagePools.filter(p => p.type === '武器');\n",
        "                if (rolePools.length > 0) {\n",
        "                    const roleStrs = rolePools.map(p => {\n",
        "                        const aRoles = Array.isArray(p.a) ? p.a.join('、') : (p.a || '');\n",
        "                        return `S-${p.s}${aRoles ? ' | A-' + aRoles : ''}`;\n",
        "                    });\n",
        "                    lines.push(`◈ 角色：${roleStrs.join('；')}`);\n",
        "                }\n",
        "                if (weaponPools.length > 0) {\n",
        "                    const weaponStrs = weaponPools.map(p => {\n",
        "                        const aWeapons = Array.isArray(p.a) ? p.a.join('、') : (p.a || '');\n",
        "                        return `◈ 音擎：${weaponStrs.join('；')}`;\n",
        "                    });\n",
        "                    lines.push(`◈ 音擎：${weaponStrs.join('；')}`);\n",
        "                }\n",
        "                lines.push('');\n",
        "            }\n",
        "        }\n",
        "        const msg = lines.join('\\n').trim();\n",
        "        redis.set(this.queryAllPoolMsgCacheKey, msg, {\n",
        "            EX: 7 * 24 * 60 * 60\n",
        "        });\n",
        "        return this.reply(msg);\n",
        "    }\n"
    ]
    lines[start_idx:end_idx] = new_method
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("PATCH_APPLIED_SUCCESSFULLY", start_idx, end_idx)
else:
    print("INDEX_NOT_FOUND", start_idx, end_idx)
