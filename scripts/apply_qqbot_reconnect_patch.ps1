# PowerShell helper script to apply or verify QQBot reconnect fix
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$patchCandidate = Join-Path $scriptDir "..\patches\sessionManager.patched.js"
if (Test-Path $patchCandidate) {
    $patchFile = (Resolve-Path $patchCandidate).Path
} elseif (Test-Path (Join-Path $scriptDir "sessionManager.patched.js")) {
    $patchFile = (Resolve-Path (Join-Path $scriptDir "sessionManager.patched.js")).Path
} elseif (Test-Path "sessionManager.patched.js") {
    $patchFile = (Resolve-Path "sessionManager.patched.js").Path
} else {
    Write-Host ">>> Error: sessionManager.patched.js not found!" -ForegroundColor Red
    exit 1
}

Write-Host ">>> Checking container zzz-bot status..." -ForegroundColor Cyan
docker ps --filter name=zzz-bot --format "{{.Names}} ({{.Status}})"

Write-Host ">>> Applying $patchFile to zzz-bot..." -ForegroundColor Cyan
docker cp $patchFile zzz-bot:/root/Yunzai/node_modules/.pnpm/qq-group-bot@1.1.0_debug@4.4.3_supports-color@7.2.0__supports-color@7.2.0/node_modules/qq-group-bot/lib/sessionManager.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ">>> Patch copied successfully. Restarting zzz-bot container..." -ForegroundColor Green
    docker restart zzz-bot
    Start-Sleep -Seconds 8
    Write-Host ">>> Recent log output:" -ForegroundColor Cyan
    docker logs --tail 30 zzz-bot
} else {
    Write-Host ">>> Error copying patch!" -ForegroundColor Red
}
