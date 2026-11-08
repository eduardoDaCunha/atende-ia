# dados/ — camada de dados do Atende.IA

Ponto único de leitura e gravação. Nenhum outro módulo lê ou grava os dados direto.

| Motor | Quando | Como escolher |
|---|---|---|
| `json.js` | Desenvolvimento no Windows, sem instalar nada | padrão (`ATENDE_BANCO` vazio ou `json`) |
| `postgres.js` | Servidor / produção | `ATENDE_BANCO=postgres` e `DATABASE_URL` |

Os dois devolvem objetos **no mesmo formato** dos arquivos JSON originais, então as rotas do `server.js` não mudam de motor para motor.

## Regras

1. **O escopo vem da sessão**, nunca da requisição: `escopoDo(s.user)` → `{ perfil, empresaId }`.
2. As rotas continuam conferindo perfil (`allow`) e empresa (`inCompany`). O PostgreSQL acrescenta uma **segunda barreira**: cada operação roda numa transação com `app.empresa_id` (ou `app.admin_geral`), e o Row Level Security filtra no banco.
3. A aplicação conecta como `atende_app`: sem poder de dono, sem apagar auditoria nem tentativas de login.
4. Mudança de esquema = arquivo novo em `esquema/` (`003_...sql`), nunca editar um já aplicado. `node dados/migrar.js` aplica só os que faltam.
5. Sessões: memória no JSON (reiniciar desloga), tabela `sessoes` no PostgreSQL (reiniciar não desloga). Só o hash do token é guardado.
6. Dados da empresa (`dadosEmpresa.obter` e `salvar`): `dados-empresa.json` no JSON, tabela `dados_empresa` no PostgreSQL. Sempre recebem o escopo de quem pede, para o RLS valer.
7. Chamados de suporte técnico (`chamados.criar`, `listar` e `atualizar`): `chamados.json` no JSON, tabela `chamados` no PostgreSQL (migração 005). O atendimento abre e lê os da própria empresa; só o admin geral muda status e resposta (o RLS também barra o UPDATE). Sem DELETE.

## Scripts

| Script | Faz | Conta usada |
|---|---|---|
| `node dados/migrar.js` | cria/atualiza tabelas; define a senha do `atende_app` | `DATABASE_URL_DONO`, `ATENDE_APP_SENHA` |
| `node dados/importar-json.js` | importa a pasta `data` do protótipo (repetível, não duplica) | `DATABASE_URL_DONO`, `ATENDE_DATA_DIR` |
| `node dados/manutencao.js` | retenção diária (90 dias login, 180 dias contatos, 2 anos auditoria) | `DATABASE_URL_DONO` |

Em produção, esses três rodam pelo serviço `ferramentas` (`docker compose run --rm ferramentas node dados/migrar.js`), que recebe o `.env` completo. O serviço `app` recebe só o `.env.app`, sem `DATABASE_URL_DONO`, `POSTGRES_PASSWORD` nem `ATENDE_APP_SENHA`; `setup-admin.js` e `recuperar-admin.js` usam só a `DATABASE_URL` e continuam no `app`. Veja `implantacao/PASSO-A-PASSO.md`, etapa 6.

## Testes

- `bash rodar-testes.sh` — todas as suítes no motor JSON.
- `bash rodar-testes.sh --postgres` — as mesmas suítes com o servidor no PostgreSQL (um banco temporário por teste), mais `tests/postgres.js` (RLS direto no banco, reinício, reenvio da Meta, importação). Precisa de `TESTE_PG_DONO=postgres://dono:senha@127.0.0.1:5432/postgres` e `TESTE_PG_APP_SENHA`.
- No Windows, o banco de teste do Docker (`atende-ia-dados/docker-compose.yml`, porta 55432) serve para isso.

## Limites conhecidos

- Listas do painel trazem no máximo 1.000 itens (sem "carregar mais" ainda); conversas mostram as 300 mensagens mais recentes.
- Bloqueio de conta por tentativas e limites de requisição ficam na memória do processo (reiniciam com ele).
- Um número de WhatsApp por instalação (`WHATSAPP_EMPRESA_ID`).
