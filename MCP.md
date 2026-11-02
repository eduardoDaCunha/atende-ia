# Servidor MCP local (Task 3)

`mcp.js` expõe as ferramentas do Atende.IA para clientes **MCP** (Model Context Protocol), como Claude Code e Maestri, **no mesmo computador**. O cliente inicia o processo e conversa por entrada/saída padrão (stdio), com JSON-RPC 2.0, uma mensagem por linha. **Nenhuma porta de rede é aberta.**

## O que expõe

As ferramentas do catálogo (`catalogo.js`), pelas mesmas regras do núcleo (`FERRAMENTAS.md`): validação, limite por minuto e saída sem segredos.

| Política | Padrão |
|---|---|
| Ferramentas `leitura` e `sensivel` | Expostas |
| Ferramentas com `dadosPessoais` (`ler_solicitacao`, `ler_conversa_whatsapp`) | **Escondidas.** Só aparecem com `ATENDE_MCP_DADOS_PESSOAIS=1`: o cliente repassa as respostas a um modelo de IA |
| Ferramentas `acao` | **Escondidas.** Só aparecem com `ATENDE_MCP_ACOES=1` e, mesmo assim, exigem prévia e código de confirmação |
| Detalhes de erro interno | Nunca vão ao cliente (só "Erro interno na ferramenta."); o detalhe sai no stderr |
| Saída padrão | Exclusiva do protocolo: qualquer `console.log` é desviado para o stderr |

Com a política padrão, o MCP expõe `diagnostico`, `diagnostico_testar_conexoes`, `estatisticas`, `listar_solicitacoes`, `listar_conversas_whatsapp` e `listar_empresas`. O MCP age como administrador local e lê a pasta de dados do computador (só leitura); veja `ATENDE_DATA_DIR`.

Cada ferramenta vai ao cliente com `inputSchema` e anotações (`readOnlyHint`, `destructiveHint`, `openWorldHint`). Ações recebem um campo opcional `confirmacao`: sem ele, a chamada só devolve a prévia.

Protocolo: `initialize` (versões 2025-11-25, 2025-06-18, 2025-03-26 e 2024-11-05), `ping`, `tools/list`, `tools/call`; notificações são aceitas sem resposta; lotes são aceitos. Erros: `-32700` (JSON inválido), `-32600` (requisição inválida ou antes do `initialize`), `-32601` (método não suportado), `-32602` (ferramenta desconhecida ou não liberada). Erros da própria ferramenta, como entrada inválida ou limite, voltam como resultado com `isError: true`, para o modelo poder corrigir a chamada.

## Como conectar

**Claude Code**, na pasta do projeto, com o caminho completo do `mcp.js`:

```bash
claude mcp add atende-ia -- node "C:\caminho\do\projeto\mcp.js"
```

**Outros clientes**: veja `mcp.exemplo.json`. Troque `mcp.js` pelo caminho completo se o cliente não iniciar na pasta do projeto.

**Teste manual sem cliente** (PowerShell):

```bash
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' | node mcp.js
```

## Limitações importantes

- **Ambiente do processo**: o MCP enxerga só as variáveis que o cliente lhe passa, não o `config-local.bat`, que nunca é lido. Por isso o diagnóstico pelo MCP pode mostrar IA e WhatsApp como desativados enquanto o servidor os usa. A visão do servidor em execução continua em `/api/admin/diagnostico`.
- **Sem auditoria em arquivo**: o MCP é outro processo, e a fila de gravação do `store.js` vale só dentro de um processo. Ele não grava nos arquivos do servidor.
- **Ações (Task 5)**: quando existirem, devem ser executadas pelo **servidor em execução**, via API autenticada, e não pelo processo do MCP gravando direto nos JSON. A Task 5 precisa de um token de API local para isso.
- **Não testado com um cliente real**: os testes simulam o cliente (em memória e pelo processo real por stdio). Conectar o Claude Code de verdade consome a sua assinatura e altera a configuração dele, então fica para você.

## Como testar

`node tests/mcp.js`, com ferramentas fictícias. Cobre:
- aperto de mão e negociação de versão;
- `tools/list` com e sem ações liberadas;
- chamadas válidas e inválidas, ferramenta desconhecida, método desconhecido, JSON inválido e lote;
- prévia e confirmação de uso único pelo MCP;
- erros sem detalhes internos;
- o processo real: saída padrão só com JSON e nenhum segredo do ambiente.
