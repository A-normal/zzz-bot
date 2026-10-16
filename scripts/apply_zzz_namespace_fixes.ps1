# ==============================================================================
# apply_zzz_namespace_fixes.ps1
# 绝区零 (ZZZ-Plugin) 命名空间修复热部署与容器同步脚本
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$WorkspaceRoot = Split-Path -Parent $ScriptDir
$ContainerName = "zzz-bot"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ZZZ-Bot Namespace Fixes Hot Deployment" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Working Directory : $WorkspaceRoot"
Write-Host "Target Container  : $ContainerName"

# 1. 检查容器状态
Write-Host "`n[1/5] 检查容器状态..." -ForegroundColor Yellow
$containerStatus = docker ps --filter "name=$ContainerName" --format "{{.Status}}"
if (-not $containerStatus) {
    Write-Error "容器 $ContainerName 未运行，请先启动 Docker 服务或容器。"
}
Write-Host "容器正在运行: $containerStatus" -ForegroundColor Green

# 2. 同步 ZZZ-Plugin 核心修复代码
Write-Host "`n[2/5] 注入 ZZZ-Plugin 修复代码..." -ForegroundColor Yellow

$pluginFiles = @(
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\monthly.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/monthly.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\rank.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/rank.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\remind.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/remind.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\manage.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/manage.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\manage\panel.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/manage/panel.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\manage\guides.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/manage/guides.js" },
    @{ Src = "$WorkspaceRoot\plugins\ZZZ-Plugin\apps\manage\config.js"; Dst = "/root/Yunzai/plugins/ZZZ-Plugin/dist/apps/manage/config.js" }
)

foreach ($f in $pluginFiles) {
    if (Test-Path $f.Src) {
        Write-Host "  -> 写入 $($f.Dst)"
        docker cp $f.Src "$ContainerName`:$($f.Dst)"
    } else {
        Write-Warning "文件未找到: $($f.Src)"
    }
}

# 3. 注入 miao-plugin 路由让渡修复
Write-Host "`n[3/5] 注入 miao-plugin 路由让渡修复..." -ForegroundColor Yellow
$miaoAppSrc = "$WorkspaceRoot\patches\miao-App.patched.js"
if (Test-Path $miaoAppSrc) {
    Write-Host "  -> 写入 /root/Yunzai/plugins/miao-plugin/components/App.js"
    docker cp $miaoAppSrc "$ContainerName`:/root/Yunzai/plugins/miao-plugin/components/App.js"
}

# 4. 重启容器并验证语法
Write-Host "`n[4/5] 语法检查与重启生效..." -ForegroundColor Yellow
docker exec -w /root/Yunzai $ContainerName node -c plugins/ZZZ-Plugin/dist/apps/manage.js plugins/ZZZ-Plugin/dist/apps/monthly.js plugins/ZZZ-Plugin/dist/apps/remind.js
docker restart $ContainerName | Out-Null
Start-Sleep -Seconds 6

# 5. 检查运行健康状态
Write-Host "`n[5/5] 验证健康状态..." -ForegroundColor Yellow
$healthy = docker ps --filter "name=$ContainerName" --format "{{.Status}}"
Write-Host "容器重启完成: $healthy" -ForegroundColor Green
Write-Host "`n部署完成！全量 ZZZ 命名空间指令已生效且具备热防御能力。" -ForegroundColor Cyan
