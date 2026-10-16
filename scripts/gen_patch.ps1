$script = @"

git config --global --add safe.directory /home/bjrst/docker/data/zzz-bot/yunzai/plugins/QQBot-Plugin
cd /home/bjrst/docker/data/zzz-bot/yunzai/plugins/QQBot-Plugin
git diff index.js > qqbot-mask-account.patch
cat qqbot-mask-account.patch
"@

$clean = $script -replace "`r", ""
$clean | wsl.exe --cd C:\ -d Ubuntu-26.04 -u root bash
