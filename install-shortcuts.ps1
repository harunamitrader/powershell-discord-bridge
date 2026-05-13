param(
  [string]$ShortcutName = 'PowerShell Discord Bridge'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$launcherPath = Join-Path $repoRoot 'launch-powershell-discord-bridge.cmd'
$hiddenLauncherPath = Join-Path $repoRoot 'launch-powershell-discord-bridge-hidden.vbs'
$iconPath = Join-Path $repoRoot 'assets\app-icon.ico'

foreach ($requiredPath in @($launcherPath, $hiddenLauncherPath, $iconPath)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required file not found: $requiredPath"
  }
}

$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$desktopShortcutPath = Join-Path $desktopDirectory "$ShortcutName.lnk"
$startupShortcutPath = Join-Path $startupDirectory "$ShortcutName.lnk"

$shell = New-Object -ComObject WScript.Shell

$shortcut = $shell.CreateShortcut($desktopShortcutPath)
$shortcut.TargetPath = $hiddenLauncherPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Launch PowerShell Discord Bridge without console window'
$shortcut.Save()

if (Test-Path $startupShortcutPath) {
  Remove-Item $startupShortcutPath -Force
  Write-Host "Removed startup shortcut: $startupShortcutPath"
}

Write-Host "Created desktop shortcut:"
Write-Host " - $desktopShortcutPath"
