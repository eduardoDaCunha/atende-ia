@echo off
REM Copie este arquivo para config-local.bat e preencha com os seus valores.
REM config-local.bat fica fora do Git: NUNCA publique este conteudo preenchido.

REM --- Tailscale (opcional). Encontre o hostname com: tailscale status --self
set "TAILSCALE_HOST=SEU-COMPUTADOR.SUA-TAILNET.ts.net"

REM --- IA (opcional). Chave do Google AI Studio. Sem ela, respostas de demonstracao.
set "GEMINI_API_KEY="
REM Teto diario de chamadas da IA no chat de demonstracao ("Experimente agora"). Padrao: 100.
REM set "ATENDE_IA_LIMITE_DEMO_DIA=100"

REM --- WhatsApp Cloud API (Meta). Veja WHATSAPP-TESTE.md
REM Token que VOCE inventa (minimo 16 caracteres) e cola tambem no painel da Meta.
set "WHATSAPP_VERIFY_TOKEN="
REM Meta for Developers > seu app > Configuracoes do app > Basico > Chave secreta do app
set "WHATSAPP_APP_SECRET="
REM WhatsApp > Configuracao da API > Token de acesso
set "WHATSAPP_TOKEN="
REM WhatsApp > Configuracao da API > Identificacao do numero de telefone
set "WHATSAPP_PHONE_NUMBER_ID="
REM ID da empresa (painel admin > Empresas) dona deste numero: o atendimento dela ve as conversas.
REM Sem ele, so administradores veem as conversas.
set "WHATSAPP_EMPRESA_ID="
REM Numeros que podem receber resposta durante o teste, com 55 e DDD, separados por virgula.
set "WHATSAPP_ALLOWED_NUMBERS="

REM --- Alertas de seguranca (opcionais). So ative apos aprovar um modelo na Meta.
REM Destinatario: celular brasileiro, somente digitos, com 55 + DDD + 9 digitos.
REM Nunca coloque dados reais neste arquivo de exemplo versionado.
set "SECURITY_WHATSAPP_ENABLED=0"
set "SECURITY_WHATSAPP_TO="
REM Modelo aprovado, corpo com um parametro de texto {{1}} para o resumo.
set "SECURITY_WHATSAPP_TEMPLATE="
set "SECURITY_WHATSAPP_LANGUAGE=pt_BR"

REM ---- Banco de dados (opcional no Windows) ----
REM Padrao: arquivos JSON na pasta de dados permanentes. Para testar com PostgreSQL
REM (ex.: o banco de teste do atende-ia-dados, porta 55432), rode "npm.cmd install" e preencha:
REM set "ATENDE_BANCO=postgres"
REM set "DATABASE_URL=postgres://atende_app:SENHA@127.0.0.1:55432/atende_teste"
