@echo off
cd /d "%~dp0"
title Atende.IA v0.3.8.3 - Porta 3011
set "PORT=3011"
REM Tailscale Serve: acesso HTTPS privado. Sem Funnel ou domínio público.
REM O hostname privado fica em config-local.bat, fora do Git. Modelo: config-local.exemplo.bat
if exist "%~dp0config-local.bat" call "%~dp0config-local.bat"
echo ==================================================
echo      ATENDE.IA - GESTAO LOCAL V0.3.8.3
echo ==================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 22+.
  pause
  exit /b 1
)
node preparar-dados.js --check
if errorlevel 1 (
  echo Use PREPARAR-DADOS.bat para importar suas contas antes de iniciar.
  pause
  exit /b 1
)
echo Se ainda nao criou o administrador, use CRIAR-ADMIN.bat.
echo.
echo Pagina comercial: http://127.0.0.1:3011
echo Acesso interno (somente para sua equipe): http://127.0.0.1:3011/acesso
echo.
if defined TAILSCALE_HOST (echo Tailscale HTTPS privado: https://%TAILSCALE_HOST%/) else (echo Tailscale desativado: copie config-local.exemplo.bat para config-local.bat e informe seu hostname.)
echo Mantenha esta janela aberta para usar o sistema.
node server.js
pause
