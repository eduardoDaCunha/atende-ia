# Ferramentas de integração (Task 2: núcleo)

Toda ferramenta do Atende.IA — usada pelo painel, pela linha de comando e, na Task 3, por um conector MCP — passa pelo mesmo núcleo (`ferramentas.js`). Assim, as regras de segurança ficam num lugar só, e não em cada ferramenta.

## Arquivos

| Arquivo | Papel |
|---|---|
| `ferramentas.js` | Núcleo: `definirFerramenta`, `criarRegistro` (listar/executar), validação, perfis, limite, auditoria, confirmação |
| `catalogo.js` | Onde as ferramentas são registradas; também é a linha de comando local |
| `sanitizar.js` | `semSegredos`: última barreira contra tokens, telefones, IDs e caminhos na saída |
| `diagnostico.js` | Primeira ferramenta (Task 1) |

## O que o núcleo garante

- **Níveis**: `leitura` (só consulta, 60/min), `sensivel` (consulta serviços externos ou dados restritos, 5/min) e `acao` (altera ou envia algo, 10/min, sempre com confirmação). Cada ferramenta pode baixar o seu limite.
- **Perfis**: cada ferramenta declara quem pode usá-la (`admin`, `atendimento`, `cliente`; padrão: só `admin`). `listar` só mostra o que o perfil pode usar.
- **Entrada validada**: esquema JSON simples (`string`, `integer`, `number`, `boolean`, `enum`, tamanhos, mínimo/máximo, `pattern`, `default`). Campos desconhecidos são recusados.
- **Saída limpa**: todo resultado passa por `semSegredos`.
- **Auditoria sem conteúdo**: registra `ferramenta_<nome>`, quem usou, `ok`/`falha` e só os **nomes** dos campos, nunca os valores.
- **Confirmação em duas etapas para ações**: a primeira chamada devolve uma prévia e um código. O código vale 5 minutos e só uma vez, só para aquela ferramenta, aqueles argumentos e aquele usuário, e deixa de valer se o servidor reiniciar. Sem ele, nada acontece.
- **Origem local**: a linha de comando no próprio computador age como administrador, porque quem a executa já tem acesso aos arquivos. Ela não grava auditoria: outro processo não pode escrever nos arquivos do servidor. Acesso remoto sempre exige login com o perfil permitido.

## Ferramentas disponíveis

| Nome | Nível | Perfis | O que faz |
|---|---|---|---|
| `diagnostico` | leitura | admin | Relatório do sistema (ver `DIAGNOSTICO.md`), só com consultas a 127.0.0.1 |
| `diagnostico_testar_conexoes` | sensivel | admin | O mesmo, mais duas leituras gratuitas (Gemini e Meta). Nunca envia mensagens |

## Como usar

- **Painel/API** (com login):
  - `GET /api/ferramentas` lista as ferramentas do seu perfil;
  - `POST /api/ferramentas/<nome>` com `{"args":{...}}` executa (exige CSRF);
  - para ações, envie de novo com `{"args":{...},"confirmacao":"<código>"}`;
  - `/api/admin/diagnostico` continua funcionando e passa pelo núcleo.
- **Linha de comando**: `node catalogo.js listar` e `node catalogo.js executar <nome> '{"campo":"valor"}' [--confirmar <código>]`.

## Como criar uma ferramenta

1. Em `catalogo.js`, chame `registro.registrar({ nome, titulo, descricao, nivel, perfis, entrada, executar })`; se o nível for `acao`, inclua também `previa`.
2. Escolha o **menor** nível e os **menores** perfis que resolvem o caso.
3. Nunca devolva texto de mensagens, telefones ou segredos sem necessidade. `semSegredos` é uma rede de segurança, não um substituto.
4. Cubra em `tests/ferramentas.js` (ou num teste próprio): permissão, entrada inválida e, para ações, que a prévia não altera nada.

## Como testar

`node tests/ferramentas.js`, com ferramentas e usuários fictícios. Cobre:
- definições inválidas e validação de entrada;
- perfis e limite por minuto (com relógio simulado);
- auditoria sem valores e saída sem segredos;
- confirmação: outro argumento, outro usuário, código adulterado, reutilizado, expirado ou de outro processo;
- catálogo, linha de comando e as rotas no servidor real (login, CSRF, perfil, 404 e 400).

## Pendente (próximas tasks)

- **Task 3**: servidor MCP local (stdio) usando `listar`/`executar` deste núcleo.
- **Tasks 4 a 6**: ferramentas de leitura do negócio, ações e integrações de saída, todas registradas aqui.
- **Tela no painel admin** para listar e executar ferramentas: espera o trabalho em andamento no `painel.js`.
