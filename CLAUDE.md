# Atende.IA — instruções para o agente

Protótipo local de atendimento com IA: site público de demonstração (`site/publico`) e painel interno com perfis admin, atendimento e cliente (`site/interno`). Node.js 22+, sem dependências npm.

## Executar
- Iniciar: `INICIAR-ATENDE.bat` (ou `node server.js`). Porta 3011, só em `127.0.0.1`.
- Primeiro admin: `CRIAR-ADMIN.bat`. Recuperar admin: `RECUPERAR-ADMIN.bat`. Importar dados antigos: `PREPARAR-DADOS.bat`.
- Testes: `node tests/smoke.js`, `node tests/tailscale.js`, `node tests/dados-permanentes.js`, `node tests/atualizacoes-seguras.js`. Rode todos depois de mudar `server.js`, `auth.js` ou `store.js`. Um `EBUSY` na limpeza da pasta temporária no Windows é conhecido e não indica falha; vale a linha `OK:`.

## Estrutura
- `server.js`: rotas HTTP e API. `auth.js`: hash de senha e sessões. `store.js`: leitura e gravação JSON com trava.
- Dados reais ficam fora do projeto, em `%LOCALAPPDATA%\AtendeIA\data` (ou `ATENDE_DATA_DIR`).
- `site/interno/painel.js` serve as quatro páginas internas pelo `data-page` do `<body>`; `empresas.js` só existe no admin e usa as funções globais de `painel.js`.

## Regras de segurança (obrigatórias)
- Nunca leia, copie, exiba ou versione o conteúdo de `%LOCALAPPDATA%\AtendeIA\data` nem de `config-local.bat`.
- Nunca grave senhas, chaves de API (`GEMINI_API_KEY`), tokens, hostnames `*.ts.net` reais ou dados pessoais em arquivos versionados. Use variáveis de ambiente, `config-local.bat` ou valores fictícios.
- Não troque o host para `0.0.0.0` e não habilite Tailscale Funnel.
- Monte DOM com `textContent`, nunca `innerHTML` com dados do usuário.
- Antes de cada commit, confira `git status` e `git diff --cached`; não use `git add` em arquivos ignorados.
- Ao mudar `painel.js` ou `painel.css`, atualize o `?v=` em todas as páginas de `site/interno`.
