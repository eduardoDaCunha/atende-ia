# WhatsApp — teste com a API oficial da Meta

O agente responde pelo WhatsApp usando a **WhatsApp Cloud API** (oficial). O teste usa o **número de teste gratuito da Meta**, não o seu número comercial. Os nomes dos menus da Meta mudam com frequência: se algum não bater, procure pelo item equivalente.

## Como funciona

```
Seu celular ──► WhatsApp (Meta) ──► túnel HTTPS ──► whatsapp.js (127.0.0.1:3012, só /webhook/whatsapp)
                                                         └─► mesma lógica de resposta do site (Gemini ou demonstração)
```

- `whatsapp.js` roda separado do painel. O túnel aponta **só** para a porta 3012: o painel (3011) continua fora da internet.
- Toda mensagem precisa da assinatura da Meta (`X-Hub-Signature-256`). Sem ela, é recusada.
- As conversas ficam só na memória e somem ao fechar o programa. Nada é gravado em `data/`.
- Os logs mostram só os 4 últimos dígitos do número, nunca o texto.

## 1. Criar o app na Meta (uma vez)

1. Entre em **developers.facebook.com** com a sua conta do Facebook e clique em **Meus apps → Criar app**.
2. Escolha o caso de uso do **WhatsApp** (ou o tipo **Empresa**) e vincule ao seu portfólio empresarial.
3. No menu do app, abra **WhatsApp → Configuração da API** (API Setup). Ali estão:
   - o **número de teste** da Meta (remetente);
   - a **Identificação do número de telefone** (Phone number ID) → `WHATSAPP_PHONE_NUMBER_ID`;
   - o **token de acesso temporário** (vale 24 horas) → `WHATSAPP_TOKEN`.
4. Em **Para** (destinatários), adicione o seu celular e confirme pelo código que chega no WhatsApp. Só números cadastrados ali conversam com o número de teste (até 5).
5. Em **Configurações do app → Básico**, copie a **Chave secreta do app** → `WHATSAPP_APP_SECRET`.

## 2. Preencher o config-local.bat

Abra `config-local.exemplo.bat`, copie as linhas do bloco **WhatsApp** para o seu `config-local.bat` e preencha:

- `WHATSAPP_VERIFY_TOKEN`: uma frase que **você inventa** (mínimo 16 caracteres, sem espaços). Ela será colada na Meta no passo 4.
- `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`: copiados da Meta.
- `WHATSAPP_ALLOWED_NUMBERS`: o seu celular com 55 e DDD (ex.: `5548999990000`). Durante o teste, só esses números recebem resposta.
- `GEMINI_API_KEY` (opcional): sem ela, o agente usa respostas prontas de demonstração.

O `config-local.bat` fica fora do Git. **Nunca** cole esses valores em outro arquivo, chat ou print.

## 3. Ligar o módulo e o túnel

1. Execute **INICIAR-WHATSAPP.bat** e deixe a janela aberta.
2. Instale o túnel da Cloudflare (uma vez), num PowerShell:
   `winget install --id Cloudflare.cloudflared -e`
3. Em outro PowerShell, abra o túnel **para a porta 3012**:
   `cloudflared tunnel --url http://127.0.0.1:3012`
4. Copie o endereço `https://....trycloudflare.com` que aparecer.

> Nunca use `--url http://127.0.0.1:3011`: isso publicaria o painel administrativo.

## 4. Conectar o webhook na Meta

1. Em **WhatsApp → Configuração** (Configuration), na seção **Webhook**, clique em **Editar**.
2. **URL de callback:** `https://SEU-ENDERECO.trycloudflare.com/webhook/whatsapp`
3. **Token de verificação:** o mesmo `WHATSAPP_VERIFY_TOKEN` do passo 2.
4. Clique em **Verificar e salvar**. Se der erro, confira se a janela do INICIAR-WHATSAPP e o túnel estão abertos.
5. Em **Campos do webhook**, assine o campo **messages**.

## 5. Testar

Do seu celular, mande uma mensagem para o **número de teste** da Meta. A janela do INICIAR-WHATSAPP mostra `Respondida: ***1234`.

## Limitações do teste

- O **token temporário** expira em 24 horas: gere outro na página da API e atualize o `config-local.bat`.
- O endereço do **túnel rápido muda** cada vez que você o abre: atualize a URL de callback na Meta.
- Feche o túnel (`Ctrl+C`) quando terminar de testar.
- Por enquanto o agente só responde texto e não cria solicitações no painel.

## Antes de usar o número comercial ou vender

- Ligar o seu número do WhatsApp Business à API pode mudar o uso dele no aplicativo. Confira na Meta as regras atuais (incluindo o modo de coexistência com o app) **antes** de migrar.
- Troque o token temporário por um token permanente de **usuário do sistema**, verifique a empresa na Meta e use um túnel/domínio fixo.
- Revise LGPD: aviso de privacidade ao cliente, quanto tempo guardar conversas e quem pode vê-las.
