param(
  [string]$SignalPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$splashScriptPath = Join-Path $repoRoot 'launch-multicli-discord-bridge-splash.ps1'
$launcherHostPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $splashScriptPath)) {
  throw "Required file not found: $splashScriptPath"
}

if (-not (Test-Path -LiteralPath $launcherHostPath)) {
  throw "Required file not found: $launcherHostPath"
}

if (-not $SignalPath) {
  $SignalPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName())
}

Set-Content -LiteralPath $SignalPath -Value 'starting' -NoNewline
$env:MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL = $SignalPath

function Test-BuildRequired {
  $outputs = @(
    'dist\renderer\index.html',
    'dist-electron\main\index.js',
    'dist-electron\preload\index.js'
  )
  $inputs = @(
    'index.html',
    'package.json',
    'tsconfig.json',
    'tsconfig.electron.json',
    'vite.config.ts',
    'src'
  )

  $missingOutputs = $outputs | Where-Object { -not (Test-Path -LiteralPath $_) }
  if ($missingOutputs.Count -gt 0) {
    return $true
  }

  $sourceFiles = foreach ($inputPath in $inputs) {
    if (-not (Test-Path -LiteralPath $inputPath)) {
      continue
    }

    $item = Get-Item -LiteralPath $inputPath
    if ($item.PSIsContainer) {
      Get-ChildItem -LiteralPath $item.FullName -File -Recurse -ErrorAction SilentlyContinue
    } else {
      $item
    }
  }

  if (-not $sourceFiles) {
    return $true
  }

  $latestSource = ($sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
  $earliestOutput = ($outputs | ForEach-Object { Get-Item -LiteralPath $_ } | Sort-Object LastWriteTimeUtc | Select-Object -First 1).LastWriteTimeUtc
  return $latestSource -gt $earliestOutput
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  Write-Host $Message
  & $Action
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Test-BridgeMainWindowVisible {
  $bridgeWindow = Get-Process -Name electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq 'multicli-discord-bridge' } |
    Select-Object -First 1

  return $null -ne $bridgeWindow
}

function Start-BridgeApp {
  $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
  $startupProcess = Start-Process -FilePath $npmCommand -ArgumentList @('run', 'start') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(120)

  while ((Get-Date) -lt $deadline) {
    if (Test-BridgeMainWindowVisible) {
      return 0
    }

    if ($startupProcess.HasExited -and $startupProcess.ExitCode -ne 0) {
      return $startupProcess.ExitCode
    }

    Start-Sleep -Milliseconds 200
  }

  if (Test-BridgeMainWindowVisible) {
    return 0
  }

  if ($startupProcess.HasExited) {
    return $startupProcess.ExitCode
  }

  throw 'Timed out waiting for the multicli-discord-bridge window to appear.'
}

Start-Process -FilePath $launcherHostPath -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-WindowStyle',
  'Hidden',
  '-File',
  $splashScriptPath,
  '-SignalPath',
  $SignalPath
) -WindowStyle Hidden

$exitCode = 0

try {
  Set-Location -LiteralPath $repoRoot

  if (-not (Test-Path -LiteralPath 'node_modules')) {
    Invoke-Step -Message 'Installing dependencies...' -Action { npm install }
  }

  if (Test-BuildRequired) {
    Invoke-Step -Message 'Building app...' -Action { npm run build }
  }

  $exitCode = Start-BridgeApp
} finally {
  Remove-Item Env:MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $SignalPath) {
    Remove-Item -LiteralPath $SignalPath -Force -ErrorAction SilentlyContinue
  }
}

exit $exitCode
