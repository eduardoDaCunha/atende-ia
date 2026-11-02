-- Atende.IA | Camada de dados | Migração 001: esquema inicial multiempresa
-- Alvo: PostgreSQL 17 ou 18 (testado em 16.15, que é o mínimo aceito: usa NULLS NOT DISTINCT).
-- Convenções: tabelas e colunas em português, snake_case; ids uuid gerados pela aplicação
-- (mantém os ids atuais dos JSON); datas em timestamptz (UTC); dinheiro em centavos (integer).
--
-- Isolamento: toda tabela de dados de cliente tem empresa_id NOT NULL, chaves estrangeiras
-- compostas (empresa_id, id) impedem ligar registros de empresas diferentes, e Row Level
-- Security (RLS) filtra pela empresa da transação. A aplicação conecta com o papel
-- atende_app, que não é dono das tabelas e não ignora RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS migracoes_esquema (
  versao      integer PRIMARY KEY,
  descricao   text NOT NULL,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);

-- Contexto da transação, definido pelo Back End com SET LOCAL a cada operação:
--   app.empresa_id   uuid da empresa do usuário (vazio para administrador geral)
--   app.admin_geral  'on' somente para administrador geral da Atende.IA
CREATE SCHEMA IF NOT EXISTS atende;
CREATE OR REPLACE FUNCTION atende.empresa_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.empresa_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION atende.admin_geral() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.admin_geral', true), '') = 'on' $$;

-- ---------------------------------------------------------------- empresas e assinaturas
CREATE TABLE empresas (
  id            uuid PRIMARY KEY,
  nome          text NOT NULL CHECK (char_length(nome) BETWEEN 3 AND 100),
  cidade        text NOT NULL DEFAULT '' CHECK (char_length(cidade) <= 80),
  uf            char(2) NOT NULL,
  fuso_horario  text NOT NULL CHECK (fuso_horario IN ('America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha')),
  contato       text NOT NULL DEFAULT '' CHECK (char_length(contato) <= 120),
  observacoes   text NOT NULL DEFAULT '' CHECK (char_length(observacoes) <= 500),
  situacao      text NOT NULL DEFAULT 'em_configuracao' CHECK (situacao IN ('em_configuracao','ativa','pausada')),
  criada_em     timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

-- Histórico de assinaturas (hoje é um objeto dentro da empresa, sobrescrito a cada edição).
-- Apenas uma assinatura vigente (vigente_ate IS NULL) por empresa.
CREATE TABLE assinaturas (
  id                    uuid PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  plano                 text NOT NULL CHECK (plano IN ('essencial','profissional','personalizado')),
  situacao              text NOT NULL CHECK (situacao IN ('teste','ativa','atrasada','suspensa','cancelada')),
  implantacao_centavos  integer CHECK (implantacao_centavos BETWEEN 0 AND 100000000),
  mensalidade_centavos  integer CHECK (mensalidade_centavos BETWEEN 0 AND 100000000),
  proximo_vencimento    date,
  integracao_pagamento  boolean NOT NULL DEFAULT false,
  vigente_desde         timestamptz NOT NULL DEFAULT now(),
  vigente_ate           timestamptz,
  CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_desde)
);
CREATE UNIQUE INDEX assinaturas_uma_vigente ON assinaturas (empresa_id) WHERE vigente_ate IS NULL;

-- ---------------------------------------------------------------- usuários
-- Administrador geral não pertence a empresa; cliente e atendimento sempre pertencem.
CREATE TABLE usuarios (
  id                    uuid PRIMARY KEY,
  empresa_id            uuid REFERENCES empresas(id),
  usuario               text NOT NULL CHECK (usuario ~ '^[a-z0-9._-]{3,30}$'),
  nome                  text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  perfil                text NOT NULL CHECK (perfil IN ('cliente','atendimento','admin')),
  ativo                 boolean NOT NULL DEFAULT true,
  trocar_senha          boolean NOT NULL DEFAULT true,
  senha_hash            text NOT NULL,   -- scrypt hex, mesmo formato do auth.js
  senha_salt            text NOT NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CHECK ((perfil = 'admin') = (empresa_id IS NULL)),
  UNIQUE (empresa_id, id)        -- alvo das chaves compostas
);
CREATE UNIQUE INDEX usuarios_usuario_unico ON usuarios (usuario);  -- login global, como hoje
CREATE INDEX usuarios_por_empresa ON usuarios (empresa_id, perfil) WHERE empresa_id IS NOT NULL;

-- ---------------------------------------------------------------- configuração do agente
-- Hoje existe um único empresa.json para a instalação inteira. Proposta: uma linha por
-- empresa; empresa_id NULL = configuração do site público de demonstração.
CREATE TABLE configuracoes_agente (
  id                uuid PRIMARY KEY,
  empresa_id        uuid REFERENCES empresas(id),
  nome              text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 90),
  nome_assistente   text NOT NULL CHECK (char_length(nome_assistente) BETWEEN 1 AND 90),
  area_atendimento  text NOT NULL DEFAULT '' CHECK (char_length(area_atendimento) <= 250),
  servicos          text[] NOT NULL CHECK (cardinality(servicos) BETWEEN 1 AND 20),
  politica          text NOT NULL DEFAULT '' CHECK (char_length(politica) <= 700),
  contato           text NOT NULL DEFAULT '' CHECK (char_length(contato) <= 400),
  boas_vindas       text NOT NULL DEFAULT '' CHECK (char_length(boas_vindas) <= 700),
  atualizada_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (empresa_id)
);

-- ---------------------------------------------------------------- solicitações
CREATE TABLE solicitacoes (
  id             uuid PRIMARY KEY,
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  cliente_id     uuid NOT NULL,
  nome_cliente   text NOT NULL CHECK (char_length(nome_cliente) <= 80),
  assunto        text NOT NULL CHECK (char_length(assunto) BETWEEN 5 AND 100),
  descricao      text NOT NULL CHECK (char_length(descricao) BETWEEN 10 AND 2000),
  situacao       text NOT NULL DEFAULT 'novo' CHECK (situacao IN ('novo','em_andamento','aguardando_cliente','resolvido')),
  prioridade     text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa','normal','alta')),
  atribuida_a    text CHECK (char_length(atribuida_a) <= 50),   -- texto livre, como hoje
  criada_em      timestamptz NOT NULL DEFAULT now(),
  atualizada_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id),
  -- o cliente precisa ser da MESMA empresa da solicitação
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES usuarios (empresa_id, id)
);
CREATE INDEX solicitacoes_fila   ON solicitacoes (empresa_id, atualizada_em DESC, id DESC);
CREATE INDEX solicitacoes_status ON solicitacoes (empresa_id, situacao, atualizada_em DESC, id DESC);
CREATE INDEX solicitacoes_portal ON solicitacoes (empresa_id, cliente_id, atualizada_em DESC, id DESC);

CREATE TABLE mensagens_solicitacao (
  id              uuid PRIMARY KEY,
  empresa_id      uuid NOT NULL,
  solicitacao_id  uuid NOT NULL,
  autor_id        uuid REFERENCES usuarios(id),    -- NULL em dados antigos sem id
  autor_nome      text NOT NULL CHECK (char_length(autor_nome) <= 80),
  autor_perfil    text NOT NULL CHECK (autor_perfil IN ('cliente','atendimento','admin')),
  conteudo        text NOT NULL CHECK (char_length(conteudo) BETWEEN 1 AND 2000),
  interna         boolean NOT NULL DEFAULT false,
  criada_em       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, solicitacao_id) REFERENCES solicitacoes (empresa_id, id) ON DELETE CASCADE,
  CHECK (NOT (interna AND autor_perfil = 'cliente'))
);
CREATE INDEX mensagens_solicitacao_ordem ON mensagens_solicitacao (solicitacao_id, criada_em, id);

-- ---------------------------------------------------------------- WhatsApp
-- Chave natural passa a ser (empresa, telefone): o mesmo cliente falando com duas empresas
-- gera duas conversas separadas (hoje seria uma só, com a empresa da primeira mensagem).
CREATE TABLE conversas_whatsapp (
  id                    uuid PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  telefone              text NOT NULL CHECK (telefone ~ '^[0-9]{8,20}$'),
  nome                  text NOT NULL DEFAULT '' CHECK (char_length(nome) <= 80),
  modo                  text NOT NULL DEFAULT 'robo' CHECK (modo IN ('robo','humano')),
  atendente_nome        text CHECK (char_length(atendente_nome) <= 80),
  pedido_atendente      boolean NOT NULL DEFAULT false,
  criada_em             timestamptz NOT NULL DEFAULT now(),
  atualizada_em         timestamptz,
  ultima_do_cliente_em  timestamptz,
  UNIQUE (empresa_id, telefone),
  UNIQUE (empresa_id, id)
);
CREATE INDEX conversas_whatsapp_fila ON conversas_whatsapp (empresa_id, atualizada_em DESC NULLS LAST, id DESC);

CREATE TABLE mensagens_whatsapp (
  id             uuid PRIMARY KEY,
  empresa_id     uuid NOT NULL,
  conversa_id    uuid NOT NULL,
  de             text NOT NULL CHECK (de IN ('cliente','robo','atendente')),
  autor          text NOT NULL CHECK (char_length(autor) <= 80),
  texto          text NOT NULL CHECK (char_length(texto) <= 4096),
  id_meta        text,          -- id da mensagem na Meta: evita duplicar reenvios do webhook
  criada_em      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, conversa_id) REFERENCES conversas_whatsapp (empresa_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX mensagens_whatsapp_id_meta ON mensagens_whatsapp (empresa_id, id_meta) WHERE id_meta IS NOT NULL;
CREATE INDEX mensagens_whatsapp_ordem ON mensagens_whatsapp (conversa_id, criada_em DESC, id DESC);

-- ---------------------------------------------------------------- auditoria e segurança
-- empresa_id NULL = ação da administração geral (empresas, usuários, segurança).
CREATE TABLE auditoria (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id  uuid REFERENCES empresas(id),
  em          timestamptz NOT NULL DEFAULT now(),
  acao        text NOT NULL CHECK (char_length(acao) <= 60),
  ator        text NOT NULL CHECK (char_length(ator) <= 30),
  detalhe     text NOT NULL DEFAULT '' CHECK (char_length(detalhe) <= 200)
);
CREATE INDEX auditoria_recente ON auditoria (em DESC);
CREATE INDEX auditoria_por_empresa ON auditoria (empresa_id, em DESC) WHERE empresa_id IS NOT NULL;

-- Somente administrador geral; nunca guarda senha, token ou cookie (mesma regra de hoje).
CREATE TABLE tentativas_login (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em        timestamptz NOT NULL DEFAULT now(),
  usuario   text NOT NULL CHECK (char_length(usuario) <= 30),
  resultado text NOT NULL CHECK (resultado IN ('sucesso','falha','bloqueado','desbloqueio')),
  motivo    text NOT NULL DEFAULT '' CHECK (char_length(motivo) <= 110)
);
CREATE INDEX tentativas_login_recentes ON tentativas_login (em DESC);
CREATE INDEX tentativas_login_usuario  ON tentativas_login (usuario, em DESC);

-- Contatos do site público de demonstração (leads-demonstracao.json e
-- interesses-comerciais-teste.json). Não pertencem a empresa cliente.
CREATE TABLE contatos_demonstracao (
  id         uuid PRIMARY KEY,
  tipo       text NOT NULL CHECK (tipo IN ('orcamento','comercial')),
  dados      jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object' AND pg_column_size(dados) <= 2048),
  consentimento boolean NOT NULL CHECK (consentimento),
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contatos_demonstracao_recentes ON contatos_demonstracao (criado_em DESC);

-- ---------------------------------------------------------------- papéis e RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atende_app') THEN
    CREATE ROLE atende_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public, atende TO atende_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO atende_app;
GRANT DELETE ON mensagens_whatsapp, conversas_whatsapp, contatos_demonstracao TO atende_app;  -- só retenção
REVOKE UPDATE, DELETE ON auditoria, tentativas_login FROM atende_app;   -- registros só de inclusão
REVOKE INSERT, UPDATE, DELETE ON migracoes_esquema FROM atende_app;

-- Tabelas por empresa: vê a própria empresa; administrador geral vê todas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas','assinaturas','solicitacoes','mensagens_solicitacao',
                           'conversas_whatsapp','mensagens_whatsapp'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento_empresa ON %I
      USING (atende.admin_geral() OR %s = atende.empresa_atual())
      WITH CHECK (atende.admin_geral() OR %s = atende.empresa_atual())$p$,
      t, CASE WHEN t = 'empresas' THEN 'id' ELSE 'empresa_id' END,
         CASE WHEN t = 'empresas' THEN 'id' ELSE 'empresa_id' END);
  END LOOP;
END $$;

-- Usuários: a própria empresa; o login (antes de saber a empresa) usa a função abaixo.
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_empresa ON usuarios
  USING (atende.admin_geral() OR empresa_id = atende.empresa_atual())
  WITH CHECK (atende.admin_geral() OR empresa_id = atende.empresa_atual());

-- Configuração: a própria empresa, mais a configuração pública (empresa_id NULL) para leitura.
ALTER TABLE configuracoes_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY leitura ON configuracoes_agente FOR SELECT
  USING (empresa_id IS NULL OR atende.admin_geral() OR empresa_id = atende.empresa_atual());
CREATE POLICY escrita_admin ON configuracoes_agente FOR ALL
  USING (atende.admin_geral()) WITH CHECK (atende.admin_geral());

-- Auditoria: atendimento lê só a própria empresa; inclusão liberada (o Back End registra).
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY leitura ON auditoria FOR SELECT
  USING (atende.admin_geral() OR empresa_id = atende.empresa_atual());
CREATE POLICY inclusao ON auditoria FOR INSERT
  WITH CHECK (atende.admin_geral() OR empresa_id = atende.empresa_atual());

-- Tentativas de login: inclusão sempre (antes do login); leitura só administrador geral.
ALTER TABLE tentativas_login ENABLE ROW LEVEL SECURITY;
ALTER TABLE tentativas_login FORCE ROW LEVEL SECURITY;
CREATE POLICY leitura ON tentativas_login FOR SELECT USING (atende.admin_geral());
CREATE POLICY inclusao ON tentativas_login FOR INSERT WITH CHECK (true);

-- Contatos de demonstração: inclusão pelo site público; leitura e retenção só admin geral.
ALTER TABLE contatos_demonstracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE contatos_demonstracao FORCE ROW LEVEL SECURITY;
CREATE POLICY leitura ON contatos_demonstracao FOR SELECT USING (atende.admin_geral());
CREATE POLICY inclusao ON contatos_demonstracao FOR INSERT WITH CHECK (true);
CREATE POLICY retencao ON contatos_demonstracao FOR DELETE USING (atende.admin_geral());

-- Login: busca a conta pelo nome de usuário sem abrir a tabela inteira ao papel da aplicação.
-- SECURITY DEFINER com search_path fixo; devolve só o necessário para verificar a senha.
CREATE OR REPLACE FUNCTION atende.conta_para_login(p_usuario text)
RETURNS TABLE (id uuid, empresa_id uuid, perfil text, ativo boolean, trocar_senha boolean,
               senha_hash text, senha_salt text, nome text, usuario text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, empresa_id, perfil, ativo, trocar_senha, senha_hash, senha_salt, nome, usuario
  FROM usuarios WHERE usuario = lower(p_usuario) AND ativo
$$;
REVOKE ALL ON FUNCTION atende.conta_para_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atende.conta_para_login(text) TO atende_app;

INSERT INTO migracoes_esquema (versao, descricao) VALUES (1, 'Esquema inicial multiempresa');
COMMIT;
