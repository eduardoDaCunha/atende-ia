# Atende.IA v0.3.8.3 | Dados permanentes

Esta atualização resolve o problema de **perder o cadastro de usuários ao mudar de versão**.

## Onde ficam os dados

No Windows, os cadastros ficam em:

`%LOCALAPPDATA%\AtendeIA\data`

Isto inclui `usuarios.json`, empresas, assinaturas demonstrativas, solicitações, auditoria e outras informações armazenadas em JSON. Configurações do agente alteradas pelo painel também passam a ser gravadas nessa pasta. **Os arquivos não são apagados quando uma nova pasta do programa é extraída.**

> Não exclua a pasta de dados permanentes. Não compartilhe os arquivos `usuarios.json`, `data` nem seus backups. Esses arquivos são privados.

## Instalação de transição (uma única vez)

1. Feche **todos** os servidores do Atende.IA antes de mover os dados, inclusive os abertos no VS Code.
2. Extraia este ZIP em uma pasta nova e **guarde a pasta da versão anterior**.
3. Abra `PREPARAR-DADOS.bat`.
4. Se o programa pedir o caminho da pasta antiga, localize aquela que contém o `usuarios.json` com suas contas atuais. Informe o caminho completo da **pasta `data`**, por exemplo `C:\Users\seu_usuario\Downloads\Atende.IA-v0.3.8.2\data`.
5. Digite `IMPORTAR` quando solicitado. A pasta antiga será preservada; a cópia será feita apenas se não houver outro cadastro permanente.
6. Execute `INICIAR-ATENDE.bat` e entre usando **o mesmo nome de usuário e a mesma senha**.

Se `PREPARAR-DADOS.bat` disser que o cadastro permanente já existe, não será necessário importar de novo.

**Não use `CRIAR-ADMIN.bat` para recuperar seu cadastro antigo.** Ele serve somente para criar a primeira conta de uma instalação nova e vazia.

## Próximas atualizações compatíveis

1. Com o servidor parado, faça uma cópia de segurança da pasta permanente em local privado.
2. Extraia a nova versão do código em outra pasta.
3. Execute `INICIAR-ATENDE.bat` da versão nova, sem copiar `data` nem criar usuários.

O sistema impede que duas versões compatíveis usem os arquivos JSON ao mesmo tempo. Se encontrar uma versão ainda aberta, feche a anterior e tente novamente.

**Importante:** ao reiniciar o servidor, as sessões expiram porque são armazenadas na memória. Será necessário fazer **login novamente**, porém usando a **mesma senha**; os usuários continuam cadastrados.

## Acesso local e Tailscale privado

- Site local: `http://127.0.0.1:3011/`
- Login local: `http://127.0.0.1:3011/acesso`
- Tailscale privado: `https://SEU-COMPUTADOR.SUA-TAILNET.ts.net/`
- Login via Tailscale: acrescente `/acesso` ao endereço acima.
- O hostname real fica em `config-local.bat` (fora do Git). Copie `config-local.exemplo.bat` e preencha.

O Tailscale Serve deve apontar para `http://127.0.0.1:3011` e seu computador deve permanecer ligado. **Não habilite Tailscale Funnel.**

## WhatsApp (teste)

O agente pode responder pelo WhatsApp com a API oficial da Meta, usando o número de teste gratuito. O módulo `whatsapp.js` roda separado do painel, numa porta própria (3012), e só aceita mensagens assinadas pela Meta. Passo a passo em **WHATSAPP-TESTE.md**.

## Recuperação do administrador

Caso você esqueça a senha, encerre todos os servidores e abra `RECUPERAR-ADMIN.bat`. Ele preserva o cadastro existente, faz backup do arquivo de usuários e gera uma senha provisória. Nunca envie essa senha pelo chat.

## Diagnósticos

Em uma janela do terminal na pasta do projeto, execute:

```powershell
node tests/dados-permanentes.js
node tests/atualizacoes-seguras.js
node tests/smoke.js
node tests/tailscale.js
node scripts/verificar-imagens.js
```

Os testes criam arquivos fictícios em pastas temporárias e não alteram seu cadastro permanente.

## Limitações

O Atende.IA permanece um **protótipo local e em Tailscale privado**. O armazenamento em JSON não foi projetado para execução comercial com múltiplos processos ou empresas reais. Antes de lançar, ainda serão necessários domínio próprio, HTTPS de produção, banco transacional, autenticação mais forte, backup seguro testado, adequação legal e revisão de segurança. A integração de pagamentos é demonstrativa.
