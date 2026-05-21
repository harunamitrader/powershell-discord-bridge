@echo off
setlocal

cd /d "%~dp0"
set "MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL=%~1"
set "exit_code=0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    set "exit_code=%errorlevel%"
    goto :cleanup
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$outputs = @('dist\renderer\index.html', 'dist-electron\main\index.js', 'dist-electron\preload\index.js');" ^
  "$inputs = @('index.html', 'package.json', 'tsconfig.json', 'tsconfig.electron.json', 'vite.config.ts', 'src');" ^
  "if (($outputs | Where-Object { -not (Test-Path $_) }).Count -gt 0) { exit 1 }" ^
  "$sourceFiles = foreach ($inputPath in $inputs) { if (-not (Test-Path $inputPath)) { continue } $item = Get-Item $inputPath; if ($item.PSIsContainer) { Get-ChildItem $item.FullName -File -Recurse -ErrorAction SilentlyContinue } else { $item } };" ^
  "if (-not $sourceFiles) { exit 1 }" ^
  "$latestSource = ($sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc;" ^
  "$outputFiles = $outputs | ForEach-Object { Get-Item $_ };" ^
  "$earliestOutput = ($outputFiles | Sort-Object LastWriteTimeUtc | Select-Object -First 1).LastWriteTimeUtc;" ^
  "if ($latestSource -gt $earliestOutput) { exit 1 }" ^
  "exit 0"
if errorlevel 1 (
  echo Building app...
  call npm run build
  if errorlevel 1 (
    set "exit_code=%errorlevel%"
    goto :cleanup
  )
)

call npm run start
set "exit_code=%errorlevel%"

:cleanup
if defined MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL if exist "%MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL%" del "%MULTICLI_DISCORD_BRIDGE_SPLASH_SIGNAL%" >nul 2>&1
endlocal & exit /b %exit_code%
