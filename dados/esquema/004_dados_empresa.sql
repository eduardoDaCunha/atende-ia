-- Atende.IA | Migração 004: dados do negócio de cada empresa.
-- Uma linha por empresa: horário, endereço, serviços com preço e perguntas frequentes.
-- servicos:  [{"nome": "...", "preco": "..."}]; preço em texto ("a partir de R$ 80", "sob consulta"),
--            só para exibição, por isso não segue a convenção de centavos.
-- perguntas: [{"pergunta": "...", "resposta": "..."}]
BEGIN;

CREATE TABLE dados_empresa (
  empresa_id    uuid PRIMARY KEY REFERENCES empresas(id),
  horario       text NOT NULL DEFAULT '' CHECK (char_length(horario) <= 300),
  endereco      text NOT NULL DEFAULT '' CHECK (char_length(endereco) <= 300),
  servicos      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(servicos) = 'array' AND jsonb_array_length(servicos) <= 30 AND pg_column_size(servicos) <= 32768),
  perguntas     jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(perguntas) = 'array' AND jsonb_array_length(perguntas) <= 15 AND pg_column_size(perguntas) <= 32768),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

-- Sem DELETE: os dados são editados, nunca apagados pela aplicação.
GRANT SELECT, INSERT, UPDATE ON dados_empresa TO atende_app;

-- Cada empresa vê e altera só a própria linha; administrador geral vê todas.
ALTER TABLE dados_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE dados_empresa FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_empresa ON dados_empresa
  USING (atende.admin_geral() OR empresa_id = atende.empresa_atual())
  WITH CHECK (atende.admin_geral() OR empresa_id = atende.empresa_atual());

INSERT INTO migracoes_esquema (versao, descricao) VALUES (4, 'Dados da empresa');
COMMIT;
