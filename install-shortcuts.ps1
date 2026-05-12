param(
  [string]$ShortcutName = 'PowerShell Discord Bridge'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$launcherPath = Join-Path $repoRoot 'launch-powershell-discord-bridge.cmd'
$iconPath = Join-Path $repoRoot 'assets\app-icon.ico'

foreach ($requiredPath in @($launcherPath, $iconPath)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required file not found: $requiredPath"
  }
}

$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$shortcutPaths = @(
  (Join-Path $desktopDirectory "$ShortcutName.lnk"),
  (Join-Path $startupDirectory "$ShortcutName.lnk")
)

$shell = New-Object -ComObject WScript.Shell

foreach ($shortcutPath in $shortcutPaths) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcherPath
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.IconLocation = "$iconPath,0"
  $shortcut.Description = 'Launch PowerShell Discord Bridge'
  $shortcut.Save()
}

Write-Host "Created shortcuts:"
foreach ($shortcutPath in $shortcutPaths) {
  Write-Host " - $shortcutPath"
}
