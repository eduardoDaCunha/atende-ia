@echo off
REM Copie este arquivo para config-local.bat e preencha com os seus valores.
REM config-local.bat fica fora do Git: NUNCA publique este conteudo preenchido.

REM --- Tailscale (opcional). Encontre o hostname com: tailscale status --self
set "TAILSCALE_HOST=SEU-COMPUTADOR.SUA-TAILNET.ts.net"

REM --- IA (opcional). Chave do Google AI Studio. Sem ela, respostas de demonstracao.
set "GEMINI_API_KEY="

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
