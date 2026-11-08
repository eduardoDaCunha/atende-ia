-- Atende.IA | Migração 005: chamados de suporte técnico.
-- A equipe da empresa (perfil atendimento) pede suporte ao administrador geral do sistema.
-- Não tem relação com as solicitações dos clientes finais (tabela solicitacoes).
-- status: 'aberto' | 'em_andamento' | 'resolvido'. resposta: texto curto do administrador.
BEGIN;

CREATE TABLE chamados (
  id            uuid PRIMARY KEY,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id),          -- quem abriu
  assunto       text NOT NULL CHECK (char_length(assunto) BETWEEN 5 AND 100),
  descricao     text NOT NULL CHECK (char_length(descricao) BETWEEN 10 AND 2000),
  status        text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_andamento', 'resolvido')),
  resposta      text NOT NULL DEFAULT '' CHECK (char_length(resposta) <= 2000),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chamados_por_empresa ON chamados (empresa_id, criado_em DESC);
CREATE INDEX chamados_por_status ON chamados (status, criado_em DESC);

-- Sem DELETE: chamados não são apagados pela aplicação.
GRANT SELECT, INSERT, UPDATE ON chamados TO atende_app;

ALTER TABLE chamados ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamados FORCE ROW LEVEL SECURITY;
-- Cada empresa vê os próprios chamados; o administrador geral vê todos.
CREATE POLICY leitura ON chamados FOR SELECT
  USING (atende.admin_geral() OR empresa_id = atende.empresa_atual());
-- Abertura só na própria empresa (o admin_geral entra aqui só pela importação dos JSON).
CREATE POLICY abertura ON chamados FOR INSERT
  WITH CHECK (atende.admin_geral() OR empresa_id = atende.empresa_atual());
-- Status e resposta: só o administrador geral. O atendimento não altera nem direto no banco.
CREATE POLICY resposta ON chamados FOR UPDATE
  USING (atende.admin_geral()) WITH CHECK (atende.admin_geral());

INSERT INTO migracoes_esquema (versao, descricao) VALUES (5, 'Chamados de suporte técnico');
COMMIT;
