@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if exist "release\ZRead-win32-x64\ZRead.exe" (
  start "" "release\ZRead-win32-x64\ZRead.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12+ or run the packaged ZRead.exe.
  pause
  exit /b 1
)
if not exist "node_modules\electron\path.txt" (
  call npm.cmd install
  if errorlevel 1 goto failed
)
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:failed
echo ZRead could not start. Please check the error above.
pause
exit /b 1
