param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
    [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$projectPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectPath '.sites-runtime'
$statePath = Join-Path $runtimePath 'public-site.json'
$linkPath = Join-Path $projectPath 'site-link.txt'
$shortcutPath = Join-Path $projectPath 'open-site.url'
$localUrl = 'http://127.0.0.1:8787'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null

function Get-OwnedProcess($record) {
    if (-not $record) { return $null }
    $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if ($process -and [string]$process.StartTime.ToUniversalTime().Ticks -eq [string]$record.started) { return $process }
    return $null
}
function Get-Record($process) {
    return @{ id = $process.Id; started = [string]$process.StartTime.ToUniversalTime().Ticks }
}
function Stop-OwnedProcess($record) {
    $process = Get-OwnedProcess $record
    if ($process) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null }
}
function Save-State($state) {
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
}
function Test-LocalSite {
    try { return (Invoke-WebRequest -Uri "$localUrl/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}
function Test-TunnelRegistration($state) {
    if (-not (Get-OwnedProcess $state.tunnel) -or -not $state.url) { return $false }
    if ($state.log -and (Test-Path -LiteralPath $state.log)) {
        $recent = (Get-Content -LiteralPath $state.log -Tail 100 -Encoding UTF8) -join "`n"
        # A live process can remain after Cloudflare has expired its public tunnel.
        if ($recent.LastIndexOf('Unauthorized: Tunnel not found') -gt $recent.LastIndexOf('Registered tunnel connection')) { return $false }
    }
    return $true
}
function Clear-Links {
    [IO.File]::WriteAllText($linkPath, "Сайт остановлен. Запустите start-site.cmd.`r`n", [Text.UTF8Encoding]::new($true))
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
}
function Show-Links($publicUrl) {
    $url = if ($publicUrl) { $publicUrl } else { $localUrl }
    [IO.File]::WriteAllText($linkPath, "$url`r`n", [Text.UTF8Encoding]::new($true))
    [IO.File]::WriteAllText($shortcutPath, "[InternetShortcut]`r`nURL=$url`r`n", [Text.UTF8Encoding]::new($false))
    Write-Host ''
    Write-Host 'САЙТ ЗАПУЩЕН' -ForegroundColor Green
    Write-Host "На этом ноутбуке: $localUrl"
    Write-Host ''
    if ($publicUrl) {
        Write-Host 'ССЫЛКА ДЛЯ ДРУГИХ УСТРОЙСТВ:' -ForegroundColor Cyan
        Write-Host $publicUrl -ForegroundColor Cyan
    } else {
        Write-Host 'Публичная ссылка не создана. Сайт доступен на этом ноутбуке.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host "Ссылка сохранена: $linkPath"
    $adminPasswordPath = Join-Path $runtimePath 'admin-password.txt'
    $publicDemo = $env:SUPPORT_DEMO_MODE -ne 'false'
    try { $publicDemo = (Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 3).publicDemo } catch { }
    if ($publicDemo) { Write-Host 'Администратор доступен без пароля.' }
    elseif (Test-Path -LiteralPath $adminPasswordPath) { Write-Host "Файл пароля администратора: $adminPasswordPath" }
    Write-Host 'Чтобы открыть сайт повторно, нажмите open-site.url.'
    Write-Host 'Это окно можно закрыть. Для остановки сайта запустите stop-site.cmd.'
    if ($OpenBrowser) {
        try { Start-Process -FilePath $url | Out-Null }
        catch { Write-Host 'Не удалось открыть браузер. Скопируйте ссылку выше.' -ForegroundColor Yellow }
    }
}

$state = @{ server = $null; tunnel = $null; url = $null; log = $null }
if (Test-Path -LiteralPath $statePath) {
    try {
        $saved = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $state.server = $saved.server
        $state.tunnel = $saved.tunnel
        $state.log = $saved.log
        if ($saved.url -match '^https://[a-z0-9-]+\.trycloudflare\.com/?$') { $state.url = $saved.url }
    } catch { Write-Host 'Не удалось прочитать состояние прошлого запуска.' -ForegroundColor Yellow }
}
if ($Action -eq 'Stop') {
    Stop-OwnedProcess $state.tunnel
    Stop-OwnedProcess $state.server
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Clear-Links
    Write-Host 'Сайт остановлен. Публичная ссылка больше не работает.'
    exit 0
}
$serverReady = (Get-OwnedProcess $state.server) -and (Test-LocalSite)
$tunnelReady = Test-TunnelRegistration $state
if ($serverReady -and $tunnelReady) { Show-Links $state.url; exit 0 }
if ($Action -eq 'Status') {
    if ($serverReady) { Show-Links $null; exit 0 }
    Clear-Links
    Write-Host 'Сайт не запущен. Откройте start-site.cmd.' -ForegroundColor Yellow
    exit 1
}

try {
    if (-not $serverReady) {
        Stop-OwnedProcess $state.server
        $state.server = $null
        if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
            throw 'Порт 8787 занят другим запуском. Если открыт npm start, остановите его через Ctrl+C и повторите запуск.'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'dist/server/wrangler.json'))) {
            throw 'Сайт ещё не собран. Выполните установку и сборку из README: npm run install:ci, затем npm run build и создание базы.'
        }
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw 'Не найден Node.js. Установите Node.js 24 и повторно откройте start-site.cmd.' }
        $runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $serverLog = Join-Path $runtimePath "$runId-server.log"
        $serverError = Join-Path $runtimePath "$runId-server-error.log"
        Write-Host 'Запускаю сайт...'
        $server = Start-Process -FilePath $nodeCommand.Source -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverError -ArgumentList @('./scripts/start-local.mjs', '--port', '8787')
        $state.server = Get-Record $server
        Save-State $state
        $deadline = (Get-Date).AddSeconds(45)
        while ((Get-Date) -lt $deadline) {
            if (-not (Get-OwnedProcess $state.server)) { throw "Сервер завершился. Подробности: $serverError" }
            if (Test-LocalSite) { $serverReady = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $serverReady) { throw "Сайт не отвечает. Проверьте создание базы по README. Подробности: $serverError" }
    }
    # Recover the local server without changing an already running tunnel's URL.
    if ($tunnelReady) { Show-Links $state.url; exit 0 }
    Stop-OwnedProcess $state.tunnel
    $state.tunnel = $null
    $state.url = $null
    Save-State $state
    Write-Host "Сайт доступен на этом ноутбуке: $localUrl"
    $tunnelCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if (-not $tunnelCommand) { throw 'Не найден cloudflared. Установите его по ссылке в README, затем повторите запуск для получения публичной ссылки.' }
    Write-Host ''
    Write-Host 'Создаю публичную ссылку...'
    $runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $tunnelLog = Join-Path $runtimePath "$runId-tunnel.log"
    $tunnelError = Join-Path $runtimePath "$runId-tunnel-error.log"
    $tunnel = Start-Process -FilePath $tunnelCommand.Source -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelError -ArgumentList @('tunnel', '--no-autoupdate', '--url', $localUrl, '--protocol', 'http2')
    $state.tunnel = Get-Record $tunnel
    $state.log = $tunnelError
    Save-State $state
    $deadline = (Get-Date).AddSeconds(55)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-OwnedProcess $state.tunnel)) { throw "Туннель завершился. Подробности: $tunnelError" }
        $log = Get-Content -LiteralPath $tunnelError -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($log) {
            $urlMatch = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($urlMatch.Success -and $log -match 'Registered tunnel connection') {
                $state.url = $urlMatch.Value
                Save-State $state
                Show-Links $state.url
                exit 0
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Не удалось создать публичную ссылку. Проверьте интернет и повторите запуск. Подробности: $tunnelError"
} catch {
    $message = $_.Exception.Message
    Stop-OwnedProcess $state.tunnel
    $state.tunnel = $null
    $state.url = $null
    if ((Get-OwnedProcess $state.server) -and (Test-LocalSite)) {
        Save-State $state
        Write-Host $message -ForegroundColor Yellow
        Show-Links $null
    } else {
        Stop-OwnedProcess $state.server
        $state.server = $null
        Save-State $state
        Clear-Links
        Write-Host "Ошибка запуска: $message" -ForegroundColor Red
    }
    exit 1
}
