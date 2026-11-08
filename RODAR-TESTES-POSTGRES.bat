@echo off
REM Roda as suites no PostgreSQL de teste (Docker do atende-ia-dados, porta 55432), um banco por teste.
REM Mesmas suites do "bash rodar-testes.sh --postgres". Deixe o servidor desligado antes.
REM Senhas abaixo sao FICTICIAS, so do banco de teste local. Nunca use aqui senhas reais.
setlocal
cd /d "%~dp0"
set "TESTE_PG_DONO=postgres://postgres:senha-ficticia-teste@127.0.0.1:55432/postgres"
set "TESTE_PG_APP_SENHA=senha-ficticia-teste"
node "tests\pg-auxiliar.js" porta
if errorlevel 1 (
  echo O banco de teste nao responde na porta 55432.
  echo Ligue o TESTAR-BANCO.bat da pasta atende-ia-dados e rode este arquivo de novo.
  pause
  exit /b 2
)
set "RAIZ=%~dp0"
set "RAIZ=%RAIZ:\=/%"
set "NODE_OPTIONS=--import=file:///%RAIZ%tests/preparar-pg.mjs"
set FALHAS=0
REM Sem dados-permanentes e atualizacoes-seguras: testam a troca de versao sobre os JSON, nao o banco.
for %%T in (smoke tailscale whatsapp whatsapp-painel cidades agente-site diagnostico ferramentas mcp negocio protecao-requisicoes alertas-seguranca config-empresa proxy-confiavel mfa calculadora dados-empresa dados-empresa-ia chat-demo login-tempo limites whatsapp-limites bloqueio-login contatos-protecao postgres) do call :rodar %%T
set "NODE_OPTIONS="
echo.
echo Limpando os bancos temporarios atende_t_* ...
node "tests\pg-auxiliar.js" limpar
echo.
echo Falhas: %FALHAS%
pause
exit /b %FALHAS%
:rodar
node "tests\%1.js" >"%TEMP%\atende-teste-pg.log" 2>&1
findstr /b "PULADO" "%TEMP%\atende-teste-pg.log" >nul
if not errorlevel 1 (echo PULADO %1& exit /b 0)
findstr /b "OK" "%TEMP%\atende-teste-pg.log" >nul
if errorlevel 1 (echo FALHA %1 & set /a FALHAS+=1) else (echo ok    %1)
exit /b 0
