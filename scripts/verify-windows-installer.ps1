$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem -Path 'release' -Filter 'Frakio.Work-*-x64.exe' | Select-Object -First 1
if (-not $installer) { throw 'Windows installer was not generated.' }

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\frakio-work'
$appPath = Join-Path $installDir 'Frakio Work.exe'
$uninstaller = Join-Path $installDir 'Uninstall Frakio Work.exe'

$install = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer exited with code $($install.ExitCode)." }
if (-not (Test-Path $appPath)) { throw "Installed application is missing: $appPath" }
if (-not (Test-Path $uninstaller)) { throw "Uninstaller is missing: $uninstaller" }

$app = Start-Process -FilePath $appPath -PassThru
try {
  Write-Host 'Waiting for installed Frakio Work API.'
  $ready = $false
  $apiPort = 0
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    Start-Sleep -Seconds 1
    foreach ($port in 8787..8806) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1
        if ($health) { $ready = $true; $apiPort = $port; break }
      } catch {}
    }
    if ($ready) { break }
    if ($app.HasExited) { throw "Installed application exited early with code $($app.ExitCode)." }
  }
  if (-not $ready) { throw 'Installed application did not expose a healthy local API.' }

  Write-Host "Local API ready on port $apiPort; waiting for win-x64 Runtime and Bridge."
  $runtimeReady = $false
  $lastRuntime = $null
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    Start-Sleep -Seconds 1
    try {
      $runtime = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/hermes-runtime/status" -TimeoutSec 2
      $lastRuntime = $runtime
      $bridge = $runtime.autoStart.steps | Where-Object { $_.id -eq 'bridge' } | Select-Object -First 1
      if ($runtime.runtime.platform -eq 'win-x64' -and $runtime.bridge.ready -and $bridge.status -eq 'ready') {
        $runtimeReady = $true
        break
      }
      if ($runtime.autoStart.status -eq 'failed') { throw "Hermes Runtime failed: $($runtime.autoStart.error)" }
    } catch {
      if ($_.Exception.Message -like 'Hermes Runtime failed:*') { throw }
    }
    if ($app.HasExited) { throw "Installed application exited before Runtime became ready with code $($app.ExitCode)." }
  }
  if (-not $runtimeReady) {
    $summary = if ($lastRuntime) { $lastRuntime | ConvertTo-Json -Depth 8 -Compress } else { 'no runtime response' }
    throw "Installed win-x64 Runtime and Bridge did not become ready. Last status: $summary"
  }
  if (-not (Test-Path (Join-Path $env:USERPROFILE '.frakio-work\logs\desktop.log'))) {
    throw 'Installed application did not create its Windows user-data log.'
  }
} finally {
  if (-not $app.HasExited) { & taskkill.exe /PID $app.Id /T /F | Out-Null }
}

$remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
if ($remove.ExitCode -ne 0) { throw "Uninstaller exited with code $($remove.ExitCode)." }
Start-Sleep -Seconds 2
if (Test-Path $appPath) { throw 'Application executable remains after uninstall.' }
Write-Host 'Windows installer launch and uninstall verification passed.'
