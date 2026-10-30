@echo off
cd /d "%~dp0"
title Atende.IA - Criar PRIMEIRO administrador
node preparar-dados.js --check --initial
if errorlevel 1 (
  echo Execute PREPARAR-DADOS.bat antes de tentar criar uma nova conta.
  pause
  exit /b 1
)
node setup-admin.js
pause
