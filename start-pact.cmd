@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer, then run this launcher again.
  pause
  exit /b 1
)
node start-pact.mjs
if errorlevel 1 pause
