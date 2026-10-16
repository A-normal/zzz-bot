$py = @'
file = "/home/bjrst/docker/data/zzz-bot/yunzai/plugins/QQBot-Plugin/index.js"
with open(file, "r", encoding="utf-8") as f:
    lines = f.readlines()
for i, l in enumerate(lines[1520:1527], 1521):
    print(f"{i}: {repr(l)}")
'@

$clean = $py -replace "`r", ""
$clean | wsl.exe --cd C:\ -d Ubuntu-26.04 -u root python3
