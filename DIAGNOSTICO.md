# Diagnóstico do sistema (Task 1)

Ferramenta **somente leitura** que informa o estado do Atende.IA. O mesmo relatório (JSON, `esquema: 1`) serve a linha de comando, a rota administrativa e, no futuro, um conector MCP.

## O que informa

| Área | Itens |
|---|---|
| servidor | versão (Atende.IA e Node.js), disponibilidade, exposição de rede, Tailscale, modo publicação (`SITE_ORIGIN`) |
| ia | Gemini configurado ou modo demonstração; conexão opcional |
| whatsapp | configuração, números autorizados (só a quantidade), webhook local, conexão com a Meta (opcional), publicação do app (não verificável) |
| seguranca | alertas de segurança pelo WhatsApp (`SECURITY_WHATSAPP_*`), proteção de login, CSRF, pasta de dados, `config-local.bat` no `.gitignore` |
| limitacoes | sessões em memória, JSON sem backup automático, sem monitoramento externo, alcance do próprio diagnóstico |

Cada item traz `estado` (`ok`, `aviso`, `falha`, `info`), **`configurado`** (`true`/`false`/`null`) e **`conexao`** (`testada_ok`, `testada_falha`, `nao_testada`, `nao_aplicavel`). Configurar não é o mesmo que testar: um token presente e bem formado aparece como `configurado: true` e `conexao: nao_testada` até um teste real.

## Garantias

- Não lê `config-local.bat` nem os arquivos da pasta de dados: da pasta, só verifica se existe, se é gravável e se está fora do projeto.
- Não mostra tokens, chaves, telefones, IDs da Meta, hostname do Tailscale, mensagens nem caminhos. Uma última etapa substitui por `[oculto]` qualquer valor sensível do ambiente que tenha escapado.
- Por padrão só conversa com `127.0.0.1`: o `/api/status` do servidor e o webhook local, que responde 403 a um GET sem token.
- Com `--testar-conexoes` (ou o POST da rota), faz **duas leituras gratuitas**: metadados do modelo no Gemini (não gera texto nem consome tokens) e `GET /{phone-number-id}?fields=id` na Meta (o corpo da resposta não é usado). Nunca usa `/messages`.
- Os **alertas de segurança nunca são testados**: testar exigiria enviar uma mensagem.
- Não abre túneis, não muda portas nem a exposição de rede.

## Como usar

- Terminal: `node diagnostico.js` (texto), `node diagnostico.js --json` e `node diagnostico.js --testar-conexoes`. Código de saída: 0 sem falhas, 1 com falha, 2 se o diagnóstico quebrar.
- Painel/API (só administrador): `GET /api/admin/diagnostico` gera o relatório local a partir do **servidor em execução**, que tem as variáveis do `config-local.bat` carregadas. `POST /api/admin/diagnostico` com `{"testarConexoes":true}` também testa as conexões; exige CSRF, fica na auditoria (`diagnostico_conexoes`) e aceita no máximo 5 por minuto.
- O terminal só enxerga as variáveis do próprio processo. Rodado num PowerShell comum, mostra a IA e o WhatsApp como desativados mesmo que o servidor esteja usando os dois. Para a visão do servidor, use a rota admin.

## Como testar

`node tests/diagnostico.js`, com tudo fictício (segredos inventados, Google e Meta simuladas, servidor temporário com usuários fictícios). Cobre:

- estados com nada configurado, tudo configurado e configurações incompletas ou inválidas;
- separação configurado x testado; sucesso, recusa e falha de rede nas conexões;
- sem `testarConexoes`, só endereços `127.0.0.1`; com ele, exatamente 2 GETs externos e nenhum `/messages`;
- ausência de segredos, telefones, IDs e caminhos no JSON, no texto e no terminal do servidor;
- rota: 401 sem login, 403 para atendimento, CSRF no POST, limite de 5 por minuto, auditoria; a Meta só é consultada no POST.

## Pendente

- Tela no painel admin para o relatório. Não foi feita para não conflitar com as mudanças em andamento no `painel.js` de outro agente; a rota já está pronta para isso.
- Integrar os dados de execução dos alertas de segurança (eventos acumulados, último envio) quando esse recurso for commitado. Hoje o diagnóstico só confere a configuração `SECURITY_WHATSAPP_*`.
- Verificar a publicação do app e a validade do token na Meta exigiria permissões e chamadas adicionais; ficam como `info`.
- `tests/dados-permanentes.js` não roda com um servidor ligado na porta 3011 (trava do `recuperar-admin.js`); desligue o servidor para rodar a suíte inteira.
