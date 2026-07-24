@echo off
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start "" http://localhost:4173"
node server.mjs
