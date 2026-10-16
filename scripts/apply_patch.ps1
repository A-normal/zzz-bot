$py = @'
file = "/home/bjrst/docker/data/zzz-bot/yunzai/plugins/QQBot-Plugin/index.js"
with open(file, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_block = [
    '  List() {\n',
    '    const masked = config.token.map(item => {\n',
    '      const parts = item.split(":")\n',
    '      const botId = parts[0] || "unknown"\n',
    '      const appid = parts[1] ? (parts[1].slice(0, 3) + "***" + parts[1].slice(-3)) : "***"\n',
    '      return `Bot ID: ${botId} (AppID: ${appid})`\n',
    '    })\n',
    '    this.reply(`共${config.token.length}个账号：\\n${masked.join("\\n")}`, true)\n',
    '  }\n'
]

# line 1522 is index 1521
if 'List()' in lines[1521]:
    lines[1521:1524] = new_block
    with open(file, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("PATCH_APPLIED_SUCCESSFULLY")
else:
    print("LINE_MISMATCH", repr(lines[1521]))
'@

$clean = $py -replace "`r", ""
$clean | wsl.exe --cd C:\ -d Ubuntu-26.04 -u root python3
