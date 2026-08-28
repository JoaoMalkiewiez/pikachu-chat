@echo off
title Chat Server HTTPS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  pause
  exit /b 1
)
echo.
echo =========================================
echo          CHAT SERVER - HTTPS
echo =========================================
echo.
node --version
echo.
node server.js
pause
