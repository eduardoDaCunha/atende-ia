# WhatsApp — teste com a API oficial da Meta

O agente responde pelo WhatsApp usando a **WhatsApp Cloud API** (oficial), e a equipe acompanha e assume as conversas pelo painel de atendimento. Os nomes dos menus da Meta mudam com frequência: se algum não bater, procure pelo item equivalente.

## Como funciona

```
Cliente ──► WhatsApp (Meta) ──► túnel HTTPS ──► Atende.IA 127.0.0.1:3012 (só /webhook/whatsapp)
                                                     ├─► robô responde (Gemini ou demonstração)
                                                     └─► conversa fica no painel (data/conversas-whatsapp.json)
Equipe ──► painel 127.0.0.1:3011 /atendimento  (o túnel NUNCA aponta para cá)
```

- O webhook roda dentro do `server.js`, numa **porta própria (3012)** que só conhece `/webhook/whatsapp`. O túnel aponta só para ela: o painel continua fora da internet.
- Toda mensagem precisa da assinatura da Meta (`X-Hub-Signature-256`). Sem ela, é recusada.
- Os logs mostram só os 4 últimos dígitos do número, nunca o texto.

## No painel de atendimento

- A seção **WhatsApp → Conversas** aparece quando o WhatsApp está configurado e se atualiza a cada 10 segundos.
- **Pediu atendente**: aviso quando o cliente fala em atendente, pessoa ou orçamento.
- **Assumir conversa**: o robô para de responder aquele cliente e o atendente escreve pelo painel; a mensagem sai pelo WhatsApp.
- **Devolver ao robô**: encerra o atendimento humano.
- **Janela de 24 horas** (regra da Meta): o atendente só responde com texto livre até 24 h depois da última mensagem do cliente. Depois disso o painel bloqueia o envio; seria preciso um modelo aprovado pela Meta.
- Quem vê: administradores veem todas as conversas; o atendimento vê as da empresa definida em `WHATSAPP_EMPRESA_ID`; clientes do painel não veem.

## 1. Criar o app na Meta (uma vez)

1. Em **developers.facebook.com**, entre com seu Facebook e registre-se como desenvolvedor (celular verificado).
2. **Meus apps → Criar app**: marque **só** "Conectar-se com clientes pelo WhatsApp" e crie (ou escolha) um **portfólio empresarial**. Pode deixar a verificação da empresa para depois.
3. Em **Casos de uso → Personalizar (WhatsApp)**, use **Integrar com API**.
4. Anote em **Configurações do app → Básico** a **Chave secreta do app** → `WHATSAPP_APP_SECRET`.

## 2. Número

- **Número de teste da Meta** (Etapa 1. Experimente): gratuito, até 5 destinatários cadastrados. Pode falhar ao criar ("Ocorreu um erro ao criar a conta de teste"); nesse caso, use um número real.
- **Número real** (Etapa 2. Configuração da produção → Registre seu número): o número **não pode estar em uso no WhatsApp**. Para usar um número que está no app, é preciso apagar a conta dele no app antes — o número passa a funcionar só pela API. Um chip separado evita isso.
- Portfólio **não verificado** só cria poucas contas do WhatsApp Business. Se o botão Avançar ficar desabilitado com esse aviso, escolha uma conta existente na lista ou remova contas de teste vazias.
- Se a Meta disser "Você solicitou o código muitas vezes", espere algumas horas e use **Reenviar código**.

Da tela do número, anote a **Identificação do número de telefone** → `WHATSAPP_PHONE_NUMBER_ID` e gere o **token de acesso** → `WHATSAPP_TOKEN` (o temporário vale 24 h).

## 3. Preencher o config-local.bat

Copie o bloco **WhatsApp** de `config-local.exemplo.bat` para o seu `config-local.bat` e preencha:

- `WHATSAPP_VERIFY_TOKEN`: uma frase que **você inventa** (mínimo 16 caracteres, sem espaços), colada também na Meta no passo 5.
- `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`: copiados da Meta.
- `WHATSAPP_EMPRESA_ID`: o **ID da empresa** dona do número (aparece no cartão da empresa em Administração → Empresas). Sem ele, só administradores veem as conversas.
- `WHATSAPP_ALLOWED_NUMBERS` (recomendado no teste): só esses números recebem resposta (55 + DDD + número, separados por vírgula).
- `GEMINI_API_KEY` (opcional): sem ela, o robô usa respostas de demonstração.

O `config-local.bat` fica fora do Git. **Nunca** cole esses valores em outro arquivo, chat ou print. Configuração pela metade impede o servidor de iniciar, com uma mensagem dizendo o que falta.

## 4. Ligar

1. Execute **INICIAR-ATENDE.bat**. Com o WhatsApp configurado, a janela mostra `WhatsApp: webhook em http://127.0.0.1:3012/webhook/whatsapp`.
2. Instale o túnel da Cloudflare (uma vez): `winget install --id Cloudflare.cloudflared -e`
3. Em outro PowerShell: `cloudflared tunnel --url http://127.0.0.1:3012`
4. Copie o endereço `https://....trycloudflare.com`.

> Nunca use `--url http://127.0.0.1:3011`: isso publicaria o painel administrativo.

## 5. Conectar o webhook na Meta

1. **Etapa 2 → Configurar webhooks** (ou WhatsApp → Configuração → Webhook).
2. **URL de callback:** `https://SEU-ENDERECO.trycloudflare.com/webhook/whatsapp`
3. **Verificar token:** o mesmo `WHATSAPP_VERIFY_TOKEN`.
4. **Verificar e salvar**, depois assine o campo **messages**.

## 6. Publicar o app

Enquanto o app estiver **Não publicado**, a Meta só entrega webhooks de teste do próprio painel: **mensagens reais de clientes não chegam**. A publicação pede, entre outros itens, um link público de política de privacidade.

## Limitações do teste

- O token temporário expira em 24 h; o endereço do túnel rápido muda a cada abertura (atualize a URL na Meta).
- Feche o túnel (`Ctrl+C`) quando terminar.
- O robô só entende texto; fotos e áudios recebem um aviso e ficam registrados como "[image recebida]" etc.

## Antes de vender

- Verifique a empresa na Meta, troque o token temporário por um token permanente de usuário do sistema e use um túnel/domínio fixo.
- LGPD: aviso de privacidade ao cliente, por quanto tempo guardar as conversas (hoje: até 300 mensagens por conversa) e quem pode vê-las.
