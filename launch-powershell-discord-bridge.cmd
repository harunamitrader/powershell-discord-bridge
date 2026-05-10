@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

if not exist "dist\renderer\index.html" (
  echo Building app...
  call npm run build
  if errorlevel 1 exit /b %errorlevel%
)

call npm run start
