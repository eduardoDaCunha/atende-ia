# Segurança: proteção inicial contra excesso de requisições

Estas proteções não garantem resistência a DDoS nem ausência de vulnerabilidades. Para publicar, siga `implantacao/PASSO-A-PASSO.md`.

## Implementado no servidor do painel/site

- Limite antes de ler sessões, arquivos e corpos: 600 requisições por minuto por par TCP e 1.200 por minuto no processo. Inclui GET, páginas e rotas inexistentes.
- Excesso recebe HTTP 429 e Retry-After; não gera auditoria ou gravação para cada bloqueio.
- Login: 40 tentativas por 15 minutos por par TCP, antes da consulta de sessão. Mantidos os bloqueios por conta e os limites específicos de chat/cadastros.
- No máximo 32 respostas em andamento; excesso recebe 503. Limites de conexões, cabeçalhos, tempo de requisição e conexão ociosa.
- Corpos com tamanho declarado acima de 16.000 bytes são recusados antecipadamente; mantida a checagem durante a leitura. URL limitada a 2.048 caracteres.
- Mapa de contadores limitado a 4.096 entradas; contadores ativos não são expulsos para abrir espaço a outros identificadores.
- Cabeçalhos de IP encaminhado não são usados para identificar visitantes. Com Tailscale/proxy, usuários podem compartilhar a mesma cota; os limites são conservadores para este protótipo.

Os contadores ficam na memória e reiniciam com o processo. Estas cotas não se aplicam ao servidor separado do webhook WhatsApp e não constituem orçamento de consumo da IA.

## Próximas etapas antes de operação comercial

- [ ] Proteção de borda: proxy/CDN com limitação de tráfego e mitigação DDoS; origem inacessível diretamente.
- [x] Definir proxies confiáveis e identidade do visitante sem aceitar IP falsificado (`ATENDE_PROXY_CONFIAVEL=1`, só conexões do próprio computador; teste `proxy-confiavel`).
- [ ] Limites distribuídos por usuário/empresa/rota. Feito: teto diário de chamadas da IA (geral e do chat do site), com respostas prontas acima do teto (`ATENDE_IA_LIMITE_DIA`, `ATENDE_IA_LIMITE_SITE_DIA`; contagem na memória do processo).
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
