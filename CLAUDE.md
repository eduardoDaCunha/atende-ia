# Atende.IA — instruções para o agente

Protótipo local de atendimento com IA: site público de demonstração (`site/publico`) e painel interno com perfis admin, atendimento e cliente (`site/interno`). Node.js 22+, sem dependências npm.

## Executar
- Iniciar: `INICIAR-ATENDE.bat` (ou `node server.js`). Porta 3011, só em `127.0.0.1`.
- Primeiro admin: `CRIAR-ADMIN.bat`. Recuperar admin: `RECUPERAR-ADMIN.bat`. Importar dados antigos: `PREPARAR-DADOS.bat`.
- WhatsApp: sobe junto com o `server.js` quando `WHATSAPP_*` está no `config-local.bat`, na porta 3012. Passo a passo em `WHATSAPP-TESTE.md`.
- Testes: `node tests/smoke.js`, `node tests/tailscale.js`, `node tests/dados-permanentes.js`, `node tests/atualizacoes-seguras.js`, `node tests/whatsapp.js`, `node tests/whatsapp-painel.js`. Rode todos depois de mudar `server.js`, `auth.js`, `store.js`, `resposta.js`, `whatsapp.js` ou `conversas.js`. Testes que sobem o servidor copiam uma lista fixa de arquivos: ao criar um módulo novo usado pelo `server.js`, inclua-o nessas listas. Um `EBUSY` na limpeza da pasta temporária no Windows é conhecido e não indica falha; vale a linha `OK:`.

## Estrutura
- `server.js`: rotas HTTP e API. `auth.js`: hash de senha e sessões. `store.js`: leitura e gravação JSON com trava.
- `resposta.js`: respostas do agente (Gemini ou demonstração) para os canais `site` e `whatsapp`; só lê dados.
- `whatsapp.js`: webhook da WhatsApp Cloud API (servidor HTTP próprio, porta 3012, só `/webhook/whatsapp`); não grava arquivos.
- `conversas.js`: conversas do WhatsApp em `conversas-whatsapp.json`, modo robô/humano e janela de 24 h. Usa o `store.js`, cuja fila de gravação vale só dentro de um processo: por isso o webhook roda dentro do `server.js`, nunca em processo separado.
- `store.js` repete a troca do arquivo por alguns milissegundos em EPERM/EBUSY: no Windows, ler e gravar ao mesmo tempo falha por um instante.
- Dados reais ficam fora do projeto, em `%LOCALAPPDATA%\AtendeIA\data` (ou `ATENDE_DATA_DIR`).
- `site/interno/painel.js` serve as quatro páginas internas pelo `data-page` do `<body>`; `empresas.js` só existe no admin e usa as funções globais de `painel.js`.

## Regras de segurança (obrigatórias)
- Nunca leia, copie, exiba ou versione o conteúdo de `%LOCALAPPDATA%\AtendeIA\data` nem de `config-local.bat`.
- Nunca grave senhas, chaves de API (`GEMINI_API_KEY`), tokens, hostnames `*.ts.net` reais ou dados pessoais em arquivos versionados. Use variáveis de ambiente, `config-local.bat` ou valores fictícios.
- Não troque o host para `0.0.0.0` e não habilite Tailscale Funnel.
- Túneis públicos (Cloudflare etc.) apontam só para a porta do `whatsapp.js` (3012), nunca para a do painel (3011). O webhook deve continuar exigindo a assinatura `X-Hub-Signature-256` e expondo só `/webhook/whatsapp`.
- Tokens do WhatsApp (`WHATSAPP_*`) ficam só no `config-local.bat`. Logs nunca mostram número completo nem texto de mensagens.
- Monte DOM com `textContent`, nunca `innerHTML` com dados do usuário.
- Antes de cada commit, confira `git status` e `git diff --cached`; não use `git add` em arquivos ignorados.
- Ao mudar `painel.js` ou `painel.css`, atualize o `?v=` em todas as páginas de `site/interno`.
