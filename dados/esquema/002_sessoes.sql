-- Atende.IA | Migração 002: sessões no banco.
-- Sessões no banco: um reinício do servidor não desloga mais ninguém.
-- Só o hash SHA-256 do token é guardado; o token fica apenas no cookie do navegador.
BEGIN;

CREATE TABLE sessoes (
  chave       text PRIMARY KEY CHECK (chave ~ '^[a-f0-9]{64}$'),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf        text NOT NULL CHECK (char_length(csrf) BETWEEN 20 AND 64),
  criada_em   timestamptz NOT NULL DEFAULT now(),
  vista_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessoes_por_usuario ON sessoes (usuario_id);
CREATE INDEX sessoes_vistas ON sessoes (vista_em);
-- Sem RLS: a sessão é lida antes de se saber quem é o usuário. Nenhum dado de cliente fica aqui.
GRANT SELECT, INSERT, UPDATE, DELETE ON sessoes TO atende_app;

INSERT INTO migracoes_esquema (versao, descricao) VALUES (2, 'Sessões no banco');
COMMIT;
