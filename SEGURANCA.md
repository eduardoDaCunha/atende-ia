# Segurança: proteção inicial contra excesso de requisições

Estas proteções não garantem resistência a DDoS nem ausência de vulnerabilidades. Para publicar, siga `implantacao/PASSO-A-PASSO.md`.

## Implementado no servidor do painel/site

- Limite antes de ler sessões, arquivos e corpos: 600 requisições por minuto por visitante (ver abaixo) e 1.200 por minuto no processo. Inclui GET, páginas e rotas inexistentes.
- Excesso recebe HTTP 429 e Retry-After; não gera auditoria ou gravação para cada bloqueio.
- Login: limite de tentativas por visitante antes de ler o corpo (um por minuto e outro por 15 minutos; o login que dá certo não gasta a cota), bloqueio temporário do endereço que erra a senha de vários usuários diferentes (*password spraying*; o login certo não zera essa contagem e o bloqueio vale só para o login), bloqueio por usuário + endereço, atraso progressivo por usuário e alerta, sem bloqueio, quando as falhas no sistema inteiro passam de um patamar. Mantidos os limites específicos de chat/cadastros.
- Chat do site e demonstração: mensagem acima do tamanho máximo é recusada, o histórico aceita só turnos do visitante (o cliente não inventa respostas da IA) e cada visitante tem uma cota diária própria de respostas da IA em cada um (`ATENDE_IA_LIMITE_IP_DIA`), com respostas prontas acima dela.
- Ativar a verificação em duas etapas exige a senha atual (com o mesmo limite por conta da troca de senha, que encerra as sessões ao travar) e um código válido (com limite próprio de códigos errados), e então encerra todas as sessões do usuário e abre uma nova.
- Em produção, o `/api/status` não mostra a versão e o `robots.txt` bloqueia só `/api/` (as telas internas saem com `noindex`). `/.well-known/security.txt` (RFC 9116) traz o contato para reporte de falhas; **renovar o `Expires` antes de 24/11/2027** (`SECURITY_TXT_EXPIRA` no `server.js`).
- Caddy (`implantacao/Caddyfile`): respostas sem `Server` e sem `Via`, inclusive no `www` e no redirecionamento de HTTP para HTTPS. HSTS sem `preload`.
- No máximo 32 respostas em andamento; excesso recebe 503. Limites de conexões, cabeçalhos, tempo de requisição e conexão ociosa.
- Corpos com tamanho declarado acima de 16.000 bytes são recusados antecipadamente; mantida a checagem durante a leitura. URL limitada a 2.048 caracteres.
- Mapa de contadores limitado a 4.096 entradas; contadores ativos não são expulsos para abrir espaço a outros identificadores.
- Aviso opcional pelo Telegram de novo pedido de contato do site: leva o número curto do pedido, a hora e os dados do formulário (lista fechada de campos, cada um sem caracteres de controle ou invisíveis e cortado no tamanho máximo), em texto puro sem `parse_mode`, e o link do painel. Os dados do visitante nunca vão para o log. No máximo 10 avisos por hora (na memória); acima disso o pedido continua gravado e o log registra uma linha por hora.
- Visitante = endereço da conexão TCP (IPv6 agrupado por /64). Com `ATENDE_PROXY_CONFIAVEL=1` e conexão vinda do próprio computador (o Caddy local), vale o último valor do `X-Forwarded-For`, que o Caddy grava com o IP real. Sem essa variável atrás de um proxy local (Tailscale Serve, por exemplo), todos os visitantes dividem a mesma cota.

Os contadores ficam na memória e reiniciam com o processo. Estas cotas não se aplicam ao servidor separado do webhook WhatsApp e não constituem orçamento de consumo da IA.

## Próximas etapas antes de operação comercial

- [ ] Proteção de borda: proxy/CDN com limitação de tráfego e mitigação DDoS; origem inacessível diretamente.
- [x] Definir proxies confiáveis e identidade do visitante sem aceitar IP falsificado (`ATENDE_PROXY_CONFIAVEL=1`, só conexões do próprio computador; teste `proxy-confiavel`).
- [ ] Limites distribuídos por usuário/empresa/rota. Feito: teto diário de chamadas da IA (geral e do chat do site), com respostas prontas acima do teto (`ATENDE_IA_LIMITE_DIA`, `ATENDE_IA_LIMITE_SITE_DIA`; contagem na memória do processo) e cota diária da IA por visitante no site e na demonstração (`ATENDE_IA_LIMITE_IP_DIA`).
- [ ] Limitar fila de gravações, volume de registros, sessões e mensagens; retenção e paginação.
- [ ] Revisar o webhook separadamente: conexões, fila de processamento, eventos assinados, repetição e consumo.
- [x] Migrar JSON para banco transacional com pool limitado, índices e tempo máximo de consultas (PostgreSQL, `dados/postgres.js`; cotas por empresa ainda pendentes).
- [ ] Revisar autorização por empresa, XSS, CSRF, injeções, uploads e tratamento de segredos.
- [ ] Monitoramento de recursos, erros, bloqueios e espaço em disco sem registrar conteúdo sensível.
- [ ] Hospedagem isolada, autenticação reforçada, backups e restauração comprovada. Feito: VM própria, container sem root e só leitura, backup diário com teste de leitura, restauração testada localmente. Verificação em duas etapas (TOTP) obrigatória para admin com `ATENDE_MFA_ADMIN=1`. Falta: teste de restauração no servidor real.
- [ ] Testes de concorrência, conexões lentas, carga e revisão de segurança em ambiente isolado.

## Verificação

## Alertas opcionais no WhatsApp

Preparado, desativado por padrão. O servidor acumula sinais de excesso de requisições, login limitado, sobrecarga e corpos com tamanho declarado excessivo. Um temporizador verifica a cada minuto e envia quando houver pelo menos 20 eventos. Intervalo mínimo de cinco minutos entre tentativas, mesmo se o envio falhar. Há apenas um envio em andamento e quatro contadores limitados; não é criada uma fila de mensagens por tentativa. Eventos são sinais de atividade suspeita, não prova de invasão.

Para ativar, configurar em ambiente privado as variáveis do bloco SECURITY_WHATSAPP do arquivo de exemplo, além da integração WhatsApp existente. O destinatário precisa ser um número diferente do remetente da API e ser confirmado pelo administrador. O código não contém o telefone real. É necessário aprovar na Meta um modelo com corpo como `Atende.ia — aviso de segurança: {{1}}` e configurar seu nome e idioma. A aprovação e classificação dependem da Meta. Mensagens iniciadas pela empresa usam modelo aprovado; consulte https://whatsappbusiness.com/policy/.

O envio usa somente resumo de contagens fixas, sem IP, URL, usuário, conteúdo de mensagens ou credenciais. Falhas geram aviso genérico no terminal; aceitação pela API não confirma entrega. Reinícios apagam contagens e intervalo. Se o processo cair ou a conexão/API ficar indisponível, este mecanismo não garante aviso: monitoramento externo ainda é necessário. O webhook separado não está instrumentado para estes alertas. Nenhuma mensagem real é enviada pelos testes.

Teste: `node tests/alertas-seguranca.js`.

`node tests/protecao-requisicoes.js` usa uma cópia temporária com usuários fictícios: testa limites de GET e login, IP encaminhado falsificado, URL e corpo excessivos e ausência de gravações provocadas por esses testes. Não executa uma carga de 10.000 requisições no ambiente real. Não substitui teste de capacidade, pentest ou auditoria completa.

## Hook contra leitura de segredos pelos agentes

`.claude/settings.json` registra `.claude/hooks/bloqueia-segredos.js` (Node, sem dependências) antes de cada Read, Edit, Write, MultiEdit, NotebookEdit, Grep, Glob, Artifact, Bash e PowerShell. Ele recusa (código 2, mensagem só com a categoria): `.env` e `.env.*` (menos `.env.exemplo`/`.env.example`), `config-local.bat`, chaves e certificados, `.ssh`/`.aws`/`.gnupg`, `rclone.conf`, dados reais (`data/` na raiz do projeto, `...\AtendeIA\data`, `usuarios.json`, `sessoes*.json`, `*.db`, `*.bak` etc.); despejo de variáveis (`printenv`, `env`, `Get-ChildItem Env:`, `docker compose config`, `docker inspect/exec/run/cp`); `ssh`, `scp`, `sftp`, `rclone`, `tailscale`; git fora de `status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`, `blame`, `branch --show-current` e `remote -v`; e gravação em `.claude/settings*.json` e `.claude/hooks/`. Erro do hook ou entrada ilegível também bloqueia (falha fechada). Não grava log. O `permissions.deny` do mesmo arquivo repete as regras de leitura como segunda camada.

Limite: no Bash e no PowerShell é um filtro de texto. Comando montado de propósito (`c""at`, variável concatenada, base64, `node -e`/`python -c` que abre o arquivo, `grep -r` numa pasta com `.env`) passa. Protege contra erro e curiosidade, não contra um agente decidido a burlar. Arquivo citado com `@` pelo próprio usuário no prompt não passa pelo hook. A proteção real é o segredo nem estar no PC: os de produção só existem no servidor. Ajustes no hook são feitos à mão pelo Eduardo (o próprio hook impede os agentes). Só vale em sessões abertas nesta pasta, depois de aceitar a confiança da pasta. Teste: `node tests/hook-segredos.js`.
