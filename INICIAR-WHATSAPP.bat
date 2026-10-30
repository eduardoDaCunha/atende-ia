@echo off
cd /d "%~dp0"
title Atende.IA - WhatsApp (porta 3012)
REM Le tokens e chaves de config-local.bat, que fica fora do Git.
if not exist "%~dp0config-local.bat" (
  echo Crie o arquivo config-local.bat a partir de config-local.exemplo.bat e preencha os dados do WhatsApp.
  pause
  exit /b 1
)
call "%~dp0config-local.bat"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 22+.
  pause
  exit /b 1
)
echo ==================================================
echo      ATENDE.IA - WHATSAPP (TESTE)
echo ==================================================
echo Em outra janela, abra o tunel apontando SOMENTE para esta porta:
echo   cloudflared tunnel --url http://127.0.0.1:3012
echo Nunca aponte o tunel para a porta 3011 do painel.
echo.
node whatsapp.js
pause
