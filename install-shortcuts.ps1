param(
  [string]$ShortcutName = 'multicli-discord-bridge'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$launcherPath = Join-Path $repoRoot 'launch-multicli-discord-bridge.cmd'
$hiddenLauncherPath = Join-Path $repoRoot 'launch-multicli-discord-bridge-hidden.vbs'
$splashScriptPath = Join-Path $repoRoot 'launch-multicli-discord-bridge-splash.ps1'
$iconPath = Join-Path $repoRoot 'assets\app-icon.ico'

foreach ($requiredPath in @($launcherPath, $hiddenLauncherPath, $splashScriptPath, $iconPath)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required file not found: $requiredPath"
  }
}

$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$desktopShortcutPath = Join-Path $desktopDirectory "$ShortcutName.lnk"
$startupShortcutPath = Join-Path $startupDirectory "$ShortcutName.lnk"
$legacyShortcutNames = @('PowerShell Discord Bridge')

$shell = New-Object -ComObject WScript.Shell

foreach ($legacyShortcutName in $legacyShortcutNames) {
  foreach ($directory in @($desktopDirectory, $startupDirectory)) {
    $legacyShortcutPath = Join-Path $directory "$legacyShortcutName.lnk"
    if (Test-Path $legacyShortcutPath) {
      Remove-Item $legacyShortcutPath -Force
      Write-Host "Removed legacy shortcut: $legacyShortcutPath"
    }
  }
}

$shortcut = $shell.CreateShortcut($desktopShortcutPath)
$shortcut.TargetPath = $hiddenLauncherPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Launch multicli-discord-bridge with startup status and no console window'
$shortcut.Save()

if (Test-Path $startupShortcutPath) {
  Remove-Item $startupShortcutPath -Force
  Write-Host "Removed startup shortcut: $startupShortcutPath"
}

Write-Host "Created desktop shortcut:"
Write-Host " - $desktopShortcutPath"
