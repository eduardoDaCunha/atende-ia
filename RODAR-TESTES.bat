@echo off
REM Roda todas as suites de teste. Deixe o servidor desligado antes.
cd /d "%~dp0"
set FALHAS=0
for %%T in (smoke tailscale dados-permanentes atualizacoes-seguras whatsapp whatsapp-painel cidades agente-site diagnostico ferramentas mcp negocio protecao-requisicoes alertas-seguranca config-empresa postgres) do call :rodar %%T
echo.
echo Falhas: %FALHAS%
pause
exit /b %FALHAS%
:rodar
node "tests\%1.js" >"%TEMP%\atende-teste.log" 2>&1
findstr /b "OK PULADO" "%TEMP%\atende-teste.log" >nul
if errorlevel 1 (echo FALHA %1 & set /a FALHAS+=1) else (echo ok    %1)
exit /b 0
