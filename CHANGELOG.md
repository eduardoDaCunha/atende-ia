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
