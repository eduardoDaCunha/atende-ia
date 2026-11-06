@echo off
REM Roda todas as suites de teste. Deixe o servidor desligado antes.
cd /d "%~dp0"
set FALHAS=0
for %%T in (smoke tailscale dados-permanentes atualizacoes-seguras whatsapp whatsapp-painel cidades agente-site diagnostico ferramentas mcp negocio protecao-requisicoes alertas-seguranca config-empresa proxy-confiavel mfa calculadora dados-empresa chat-demo login-tempo limites whatsapp-limites bloqueio-login contatos-protecao postgres) do call :rodar %%T
echo.
echo Falhas: %FALHAS%
pause
exit /b %FALHAS%
:rodar
node "tests\%1.js" >"%TEMP%\atende-teste.log" 2>&1
REM Suite que imprime PULADO (ex.: postgres sem TESTE_PG_DONO) aparece como PULADO, nao como ok.
findstr /b "PULADO" "%TEMP%\atende-teste.log" >nul
if not errorlevel 1 (echo PULADO %1& exit /b 0)
findstr /b "OK" "%TEMP%\atende-teste.log" >nul
if errorlevel 1 (echo FALHA %1 & set /a FALHAS+=1) else (echo ok    %1)
exit /b 0
