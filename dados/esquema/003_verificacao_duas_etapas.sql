-- Atende.IA | Migração 003: verificação em duas etapas (TOTP) por usuário.
-- mfa_segredo: segredo ativo (base32). mfa_pendente: segredo gerado e ainda não confirmado.
BEGIN;
ALTER TABLE usuarios
  ADD COLUMN mfa_ativo    boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_segredo  text CHECK (mfa_segredo ~ '^[A-Z2-7]{16,64}$'),
  ADD COLUMN mfa_pendente text CHECK (mfa_pendente ~ '^[A-Z2-7]{16,64}$'),
  ADD CONSTRAINT mfa_ativo_tem_segredo CHECK (NOT mfa_ativo OR mfa_segredo IS NOT NULL);

-- O login precisa saber se a conta exige o código (o tipo de retorno muda: recria a função).
DROP FUNCTION atende.conta_para_login(text);
CREATE FUNCTION atende.conta_para_login(p_usuario text)
RETURNS TABLE (id uuid, empresa_id uuid, perfil text, ativo boolean, trocar_senha boolean,
               senha_hash text, senha_salt text, nome text, usuario text,
               mfa_ativo boolean, mfa_segredo text, mfa_pendente text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, empresa_id, perfil, ativo, trocar_senha, senha_hash, senha_salt, nome, usuario,
         mfa_ativo, mfa_segredo, mfa_pendente
  FROM usuarios WHERE usuario = lower(p_usuario) AND ativo
$$;
REVOKE ALL ON FUNCTION atende.conta_para_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atende.conta_para_login(text) TO atende_app;

INSERT INTO migracoes_esquema (versao, descricao) VALUES (3, 'Verificação em duas etapas');
COMMIT;
