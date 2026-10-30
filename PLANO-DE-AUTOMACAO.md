# Atende.IA | Plano de automação futura

**Estado atual: somente desenvolvimento local.** Esta é uma proposta de arquitetura, NÃO são funções já ativadas.

## Princípio
O administrador geral mantém o controle sobre as empresas de todo o Brasil, mas tarefas repetitivas serão automatizadas com auditoria, opção de desfazer e intervenção manual.

## Automação em fases
1. **Observabilidade:** monitorar disponibilidade de agentes, consumo de tokens, falhas de integração, tempos de resposta e logs de erro. Alertas em canal privado para o administrador.
2. **Assinaturas:** integrar provedor de cobrança por API/webhooks assinados, confirmar pagamento no provedor, conciliar eventos idempotentemente, atualizar situação e registrar auditoria. Não confiar somente em notificações recebidas sem autenticação.
3. **Gestão do cliente:** configurar novos agentes somente depois da confirmação real de contratação; gerar checklist de implantação; comunicar ao atendente; verificar testes de qualidade e privacidade.
4. **Segurança e backups:** rotina automatizada de cópias criptografadas com testes de restauração, revogação de sessões, alertas por tentativas suspeitas e revisão periódica de permissões.
5. **Manutenção:** atualizações versionadas com ambiente de testes, backup antes da migração, monitoramento pós-instalação e opção de reversão.

## Ações críticas sempre supervisionadas
Exclusão de dados, alteração de permissões, suspensões por pagamento e mudanças em produção exigirão regras explícitas e mecanismos de aprovação. Não automatizar decisões irreversíveis silenciosamente.

## Dependências antes do lançamento
Domínio próprio e HTTPS, banco de dados transacional com isolamento por empresa, autenticação forte com MFA, governança LGPD, backups externos seguros, contratos/termos revisados e testes de carga e invasão autorizados.

## Em desenvolvimento agora
O módulo **Empresas e assinaturas** registra plano, mensalidade e vencimento manualmente, mas não recebe dinheiro, não envia cobranças, não desativa clientes e não ativa agentes.
