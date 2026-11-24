## Em desenvolvimento | Chamados de suporte técnico
- Segurança (bloco C: N1, N4, I1, I2, I3, I5). Ativar o MFA (`/api/auth/mfa/ativar`) exige o campo `senhaAtual` no mesmo POST do `codigo`: mesma chave e limite da troca de senha (5 erros em 15 min encerram as sessões, `senha_atual_bloqueio`), e só com a senha certa o código é conferido, com limite próprio (`mfa-ativar:<usuário>`, 5 em 15 min, `mfa_ativar_bloqueado`; o desbloqueio do admin limpa). **Sai junto com o campo de senha na tela de ativação (Jubileu)**: sem ele, a tela atual não ativa o MFA. Teste do limite de 20 logins em 15 min por IP com relógio falso só de teste (`tests/relogio-falso.mjs`). `robots.txt` de produção bloqueia só `/api/`. Versão lida do `package.json` (servidor, diagnóstico e MCP); em produção o `/api/status` não mostra a versão (agora em `/api/admin/health`) e o diagnóstico não acusa "outra versão" sem o campo. Caddy sem `Server` e `Via` (inclusive `www` e HTTP). Novo `/.well-known/security.txt` (validade até 24/11/2027).
- Segurança (auditoria de 22/11, achados B1, B2 e B4). Login: 10 tentativas por minuto e 20 a cada 15 min por visitante (antes 40), e o login certo devolve a vaga; um endereço que erra a senha de mais de 8 usuários diferentes em 15 min fica 15 min sem login (só o login; acertos no meio não zeram a contagem; `login_bloqueio_ip` na auditoria, sem IP); mais de 100 falhas no sistema em 15 min geram alerta (`login_limit`) e uma linha no log, sem IP nem usuário, sem bloquear. Chat do site e demonstração: mensagem acima de 1.000 caracteres recusada, histórico só com turnos do visitante (cortados em 600) e cota de respostas da IA por IP em 24 h, à parte em cada um (`ATENDE_IA_LIMITE_IP_DIA`, padrão 20; acima, resposta pronta). Ativar o MFA encerra todas as sessões do usuário e devolve sessão e CSRF novos. Testes em `tests/bloqueio-login.js`, `tests/agente-site.js` e `tests/mfa.js`.
- Segurança (auditoria de 22/11, achados M1 e M2): o código do MFA tem limite por conta, independente do IP (5 erros em 15 min dão 429 e geram `mfa_bloqueado` na auditoria; o desbloqueio do admin zera o contador). A troca de senha usa o scrypt assíncrono e tem limite: 5 senhas atuais erradas encerram as sessões do usuário e geram `senha_atual_bloqueio` na auditoria. Testes em `tests/mfa.js`.
- Hook do Claude Code (`.claude/hooks/bloqueia-segredos.js`, registrado em `.claude/settings.json` com `permissions.deny`): agentes não leem segredos, chaves e dados reais, não usam ssh/rclone/tailscale nem git que altera, não despejam variáveis nem mexem no próprio hook; falha fechada; teste `tests/hook-segredos.js`.
- Atendimento abre chamados de suporte para a administração (tabela `chamados`, migração 005), acompanha status e resposta; admin responde no painel; aviso opcional pelo Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), sem a descrição; limites de 5 por usuário por hora e `ATENDE_LIMITE_CHAMADOS_DIA` (padrão 100).
- Aviso pelo Telegram de novo pedido de contato do site (`/api/lead` e `/api/commercial-lead`): número curto `#CODIGO`, hora com segundos, dados do formulário (limpos de caracteres de controle e invisíveis, cortados; contato com `@` vira "E-mail", senão "Telefone") e link `/atendimento#pedidos-site`; dados do visitante nunca no log; isca e pedidos recusados não avisam; no máximo 10 avisos por hora, sem afetar a gravação.

## v0.3.8.3 | Dados permanentes no Windows
- Cadastro persistente em %LOCALAPPDATA%\AtendeIA\data.
- Importador conservador, recuperacao offline e trava contra instancias simultaneas.
- Configuracao do agente atualizada no painel tambem vai para dados permanentes.
- Requer importacao manual unica com PREPARAR-DADOS.bat.

## v0.3.8.2 — Acesso privado pelo Tailscale Serve (testes)
- `TAILSCALE_HOST` valida um único host HTTPS `.ts.net` configurado no inicializador. Hosts desconhecidos continuam recusados.
- A origem HTTPS privada foi adicionada à verificação CSRF/Origin, preservando o acesso por localhost.
- Erros de navegação HTML agora respondem com HTML, sem oferecer download de `acesso.json` no Safari. APIs seguem enviando JSON.
- Diagnóstico local usa a porta correta (3011), e há testes novos para host, origem, login e isolamento.
- Não implanta SSL comercial nem publica o sistema. O projeto continua apenas para ambiente privado de desenvolvimento.

## v0.3.8.1 — Correção do login

- Define `type="submit"` explicitamente nos formulários de login e troca de senha provisória.
- Adiciona mensagem de verificação de acesso e feedback de erro caso um botão de envio não exista.
- Separa a nova versão na porta 3011 para testes.
- Preserva os controles de autenticação e isolamento entre empresas.

## v0.3.8 | Empresas e assinaturas, atuação nacional (local)

- Cadastro de empresas com cidade, UF e fuso horário brasileiro; sem limite geográfico de atendimento.
- Planos Essencial/Profissional/Sob medida com implantação, mensalidade e vencimento apenas informativos.
- Administrador geral pode gerenciar todas as empresas; clientes e atendentes vinculados à sua empresa.
- APIs de solicitações protegidas por vínculo de empresa no servidor, incluindo detalhe, resposta, prioridade e status.
- Migração dos dados de testes antigos para uma empresa de demonstração, sem apagar usuários/chamados.
- Sem meios de pagamento, cobrança, automação financeira, publicação ou dados pessoais reais.

---

# v0.3.8 | Revisão editorial e legal (somente local)

- Conteúdo público revisado para eliminar linguagem vaga e sinais de visual genérico.
- Removidos emojis visíveis e ícones decorativos, movimento de cursor e revelação por rolagem.
- Botões padronizados com cantos discretos e paleta sem roxo.
- Política de privacidade mantida, agora acompanhada de Termos e condições em `/termos`.
- Links de documentos adicionados ao rodapé e aos formulários.
- Mantido `robots.txt` com bloqueio de indexação na execução local.
- Favicon WebP de 1,8 KB, sem fotos artificiais, métricas ou avaliações inventadas.
- Termo FVA pendente de esclarecimento.
- **Não publicar sem domínio próprio, HTTPS e revisões finais.**

---

## v0.3.5 — Identidade em movimento
- Novo visual autoral da página comercial, com cores originais preservadas e acento coral.
- Microinterações e pequenas animações no agente, botões, cartões, símbolo e conteúdo.
- Indicador de digitação com três pontos e avatar reativo enquanto processa resposta.
- Botão para pausar/reiniciar animações e respeito às preferências de movimento reduzido.
- Nenhuma alteração nas regras ou dados de administração, atendimento e cliente.

## 0.3.4 — retorno no primeiro acesso (27/10/2026)
- Botão para voltar ao login durante a troca obrigatória da senha provisória; faz logout server-side e limpa os campos.
- Link para voltar à demonstração pública sem login.
- Confirmação e retorno automático ao login após senha definida.
- Novos testes de logout na sessão temporária e de manutenção da troca obrigatória.
- Porta local 3006 (sem afetar as versões anteriores).

# v0.3.3 — Separação do site público e do ambiente interno

- Demonstração pública, sem login e sem link de acesso restrito no menu.
- Código das páginas separado em `site/publico` e `site/interno`.
- Endereços dos painéis continuam protegidos por sessão, permissões e checagens no servidor.
- Testes automáticos para exposição pública e acesso direto a páginas internas.
- Porta 3005; migração opcional dos dados da v0.3.1.

# Histórico de alterações

## v0.3.1 (27/10/2026)
- Botões acessíveis para mostrar ou ocultar senhas no acesso e nos três painéis.
- Bloqueio de restauração de páginas privadas através do histórico Voltar/Avançar; exige nova autenticação.
- Máscara de interface durante validação e restauração de sessão.
- Headers anticache explícitos; porta 3003 para não colidir com a versão antiga.
- Orientações para migração manual da pasta data sem perda de usuários.

# Histórico de versões

## v0.3 — Gestão e segurança (protótipo local)
- Mantém o layout público e as três perguntas frequentes da v0.2.1.
- Acrescenta primeiro administrador via inicializador, sem senha padrão.
- Acrescenta login, senha temporária, troca obrigatória, sessões, validação de perfil e auditoria.
- Acrescenta área do cliente e solicitações privadas.
- Acrescenta central de atendimento com fila, filtros, prioridades, status, notas internas e respostas rápidas.
- Acrescenta gestão de contas, manutenção das configurações e diagnóstico para administradores.
- Usa porta 3002, sem conflitar com as versões 3000/3001.
- Não está pronta para dados reais ou uso pela internet.
