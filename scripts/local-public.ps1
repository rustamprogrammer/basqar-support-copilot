param([ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectPath '.sites-runtime'
$statePath = Join-Path $runtimePath 'public-site.json'
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
function Stop-OwnedProcesses($state) {
    foreach ($record in @($state.tunnel, $state.server)) {
        $process = Get-OwnedProcess $record
        if ($process) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null }
    }
}
function Save-State($state) {
    $json = $state | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($statePath, $json, [Text.UTF8Encoding]::new($false))
}

$state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
if ($Action -eq 'Stop') {
    if ($state) { Stop-OwnedProcesses $state; Remove-Item -LiteralPath $statePath }
    Write-Output 'Site stopped. The public link is offline.'
    exit 0
}
if ($state -and (Get-OwnedProcess $state.server) -and (Get-OwnedProcess $state.tunnel) -and $state.url) {
    Write-Output $state.url
    exit 0
}
if ($Action -eq 'Status') { Write-Output 'Site is not running.'; exit 1 }
if ($state) { Stop-OwnedProcesses $state }
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'dist/server/wrangler.json'))) {
    throw 'Build output is missing. Run npm run build first.'
}
if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8787 is used by another application.'
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$tunnelPath = (Get-Command cloudflared.exe -ErrorAction Stop).Source
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverLog = Join-Path $runtimePath "$runId-server.log"
$serverError = Join-Path $runtimePath "$runId-server-error.log"
$tunnelLog = Join-Path $runtimePath "$runId-tunnel.log"
$tunnelError = Join-Path $runtimePath "$runId-tunnel-error.log"
$state = @{ server = $null; tunnel = $null; url = $null; log = $tunnelError }
try {
    $server = Start-Process -FilePath $nodePath -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverError -ArgumentList @('--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0')
    $state.server = Get-Record $server
    Save-State $state
    $ready = $false
    $deadline = (Get-Date).AddSeconds(50)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-OwnedProcess $state.server)) { throw "Server stopped. See $serverError" }
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/messages' -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "Server did not start. See $serverError" }
    $tunnel = Start-Process -FilePath $tunnelPath -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelError -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8787', '--protocol', 'http2')
    $state.tunnel = Get-Record $tunnel
    Save-State $state
    $deadline = (Get-Date).AddSeconds(55)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-OwnedProcess $state.tunnel)) { throw "Tunnel stopped. See $tunnelError" }
        $log = Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue
        if (-not $log) { Start-Sleep -Milliseconds 500; continue }
        $urlMatch = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($urlMatch.Success -and $log -match 'Registered tunnel connection') {
            $state.url = $urlMatch.Value
            Save-State $state
            Write-Output $state.url
            exit 0
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Tunnel did not connect. See $tunnelError"
} catch {
    Stop-OwnedProcesses $state
    Save-State $state
    throw
}
