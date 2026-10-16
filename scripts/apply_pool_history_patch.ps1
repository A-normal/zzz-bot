# PowerShell script to apply or verify poolHistory single-message + progress-notice optimization patch
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$patchCandidate = Join-Path $scriptDir "..\plugins\ZZZ-Plugin\apps\poolHistory.js"
if (Test-Path $patchCandidate) {
    $patchFile = (Resolve-Path $patchCandidate).Path
} elseif (Test-Path (Join-Path $scriptDir "..\patches\poolHistory.patched.js")) {
    $patchFile = (Resolve-Path (Join-Path $scriptDir "..\patches\poolHistory.patched.js")).Path
} elseif (Test-Path (Join-Path $scriptDir "poolHistory.patched.js")) {
    $patchFile = (Resolve-Path (Join-Path $scriptDir "poolHistory.patched.js")).Path
} elseif (Test-Path "poolHistory.patched.js") {
    $patchFile = (Resolve-Path "poolHistory.patched.js").Path
} else {
    Write-Host ">>> Error: poolHistory source file not found!" -ForegroundColor Red
    exit 1
}

Write-Host ">>> Checking container zzz-bot status..." -ForegroundColor Cyan
docker ps --filter name=zzz-bot --format "{{.Names}} ({{.Status}})"

Write-Host ">>> Deploying $patchFile to zzz-bot container..." -ForegroundColor Cyan
docker cp $patchFile zzz-bot:/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/poolHistory.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ">>> Clearing stale Redis cache..." -ForegroundColor Cyan
    docker exec zzz-bot valkey-cli del ZZZ:PoolHistory:queryAllPoolMsg
    Write-Host ">>> Patch deployed. Restarting zzz-bot container..." -ForegroundColor Green
    docker restart zzz-bot
    Start-Sleep -Seconds 8
    Write-Host ">>> Recent log output:" -ForegroundColor Cyan
    docker logs --tail 30 zzz-bot
} else {
    Write-Host ">>> Error copying poolHistory patch!" -ForegroundColor Red
}
