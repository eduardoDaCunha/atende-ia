/** Atende.IA — motor de dados PostgreSQL (produção).
 *
 *  Conecta com o papel atende_app, que NÃO ignora Row Level Security. Cada operação roda numa
 *  transação que define o contexto com set_config(..., true) (vale só dentro da transação):
 *    - escopo de empresa (atendimento/cliente/webhook): app.empresa_id = empresa
 *    - administração geral e tarefas do sistema: app.admin_geral = 'on'
 *  Assim, mesmo que uma rota esqueça um filtro, o banco não devolve dados de outra empresa.
 *
 *  Os objetos devolvidos têm o MESMO formato dos arquivos JSON, para as rotas não mudarem.
 */
'use strict';
const crypto = require('node:crypto');

const LIMITE_LISTA = 1000;        // listas do painel (ainda sem "carregar mais")
const MENSAGENS_POR_CONVERSA = 300; // mensagens mais recentes exibidas por conversa
const iso = v => (v instanceof Date ? v.toISOString() : v ?? null);
const normalizar = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ conversão linha -> objeto
const usuario = r => ({ id: r.id, username: r.usuario, name: r.nome, role: r.perfil, active: r.ativo, mustChangePassword: r.trocar_senha,
  companyId: r.empresa_id || null, createdAt: iso(r.criado_em), hash: r.senha_hash, salt: r.senha_salt,
  mfaEnabled: Boolean(r.mfa_ativo), mfaSecret: r.mfa_segredo || null, mfaPending: r.mfa_pendente || null });
const empresa = r => ({ id: r.id, name: r.nome, city: r.cidade, uf: r.uf, timeZone: r.fuso_horario, contact: r.contato, notes: r.observacoes,
  state: r.situacao, createdAt: iso(r.criada_em),
  subscription: r.plano ? { plan: r.plano, status: r.sit_assinatura, setupCents: r.implantacao_centavos, monthlyCents: r.mensalidade_centavos,
    nextDueDate: r.proximo_vencimento || null, updatedAt: iso(r.vigente_desde), paymentIntegration: r.integracao_pagamento } : null });
const solicitacao = (r, mensagens = []) => ({ id: r.id, companyId: r.empresa_id, ownerId: r.cliente_id, customerName: r.nome_cliente, subject: r.assunto,
  description: r.descricao, status: r.situacao, priority: r.prioridade, assignedTo: r.atribuida_a, createdAt: iso(r.criada_em), updatedAt: iso(r.atualizada_em),
  messages: mensagens.map(m => ({ id: m.id, author: m.autor_nome, role: m.autor_perfil, content: m.conteudo, internal: m.interna, createdAt: iso(m.criada_em) })) });
const conversa = (r, mensagens = []) => ({ id: r.id, telefone: r.telefone, nome: r.nome, companyId: r.empresa_id, modo: r.modo, atendente: r.atendente_nome,
  pedidoAtendente: r.pedido_atendente, criadoEm: iso(r.criada_em), atualizadoEm: iso(r.atualizada_em), ultimaDoClienteEm: iso(r.ultima_do_cliente_em),
  mensagens: mensagens.map(m => ({ id: m.id, de: m.de, autor: m.autor, texto: m.texto, em: iso(m.criada_em), ...(m.id_meta ? { idMeta: m.id_meta } : {}) })) });
const configuracao = r => ({ name: r.nome, assistantName: r.nome_assistente, serviceArea: r.area_atendimento, services: r.servicos,
  policy: r.politica, contact: r.contato, welcome: r.boas_vindas });
const chamado = r => ({ id: r.id, companyId: r.empresa_id, userId: r.usuario_id, assunto: r.assunto, descricao: r.descricao, status: r.status,
  resposta: r.resposta, criadoEm: iso(r.criado_em), atualizadoEm: iso(r.atualizado_em) });
const dadosDaEmpresa = r => ({ horario: r.horario, endereco: r.endereco, servicos: r.servicos, perguntas: r.perguntas, atualizadaEm: iso(r.atualizada_em) });

const SQL_EMPRESAS = `SELECT e.*, a.plano, a.situacao AS sit_assinatura, a.implantacao_centavos, a.mensalidade_centavos,
  a.proximo_vencimento, a.vigente_desde, a.integracao_pagamento
  FROM empresas e LEFT JOIN assinaturas a ON a.empresa_id = e.id AND a.vigente_ate IS NULL`;

function criar(env) {
  const pg = require('pg');
  pg.types.setTypeParser(1082, v => v); // date -> 'AAAA-MM-DD' (sem fuso)
  if (!env.DATABASE_URL) throw new Error('ATENDE_BANCO=postgres exige DATABASE_URL.');
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: Number(env.ATENDE_BANCO_CONEXOES || 10),
    idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, application_name: 'atende-ia' });
  pool.on('error', err => console.error('PostgreSQL: conexão ociosa falhou:', err.message));

  /** Transação com contexto. escopo: null/admin = administração geral; senão, a empresa do usuário. */
  async function tx(escopo, fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const admin = !escopo || escopo.perfil === 'admin';
      if (!admin && !escopo.empresaId) throw Object.assign(new Error('Seu usuário ainda não está vinculado a uma empresa.'), { status: 403 });
      await c.query("SELECT set_config('app.admin_geral', $1, true), set_config('app.empresa_id', $2, true)", [admin ? 'on' : '', admin ? '' : escopo.empresaId]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') throw Object.assign(new Error('Registro duplicado.'), { status: 409 });
      throw e;
    } finally { c.release(); }
  }
  const SISTEMA = null;
  const empresaEscopo = id => ({ perfil: 'sistema', empresaId: id });

  // ---------------------------------------------------------------- usuários
  async function listarUsuarios(c, bloquear = false) {
    return (await c.query(`SELECT * FROM usuarios ORDER BY criado_em, id${bloquear ? ' FOR UPDATE' : ''}`)).rows.map(usuario);
  }
  const usuarios = {
    listar: () => tx(SISTEMA, c => listarUsuarios(c)),
    obter: id => tx(SISTEMA, async c => { const r = (await c.query('SELECT * FROM usuarios WHERE id = $1', [id])).rows[0]; return r ? usuario(r) : null; }),
    contaAtiva: nome => tx(SISTEMA, async c => {
      const r = (await c.query('SELECT * FROM atende.conta_para_login($1)', [nome])).rows[0];
      return r ? usuario({ ...r, criado_em: null }) : null;
    }),
    /** Mesma semântica do JSON: trava a tabela, roda `mudar(lista)` e grava o que mudou. */
    atualizarLista: mudar => tx(SISTEMA, async c => {
      await c.query('LOCK TABLE usuarios IN SHARE ROW EXCLUSIVE MODE');
      const lista = await listarUsuarios(c);
      const antes = new Map(lista.map(u => [u.id, structuredClone(u)]));
      const resultado = await mudar(lista);
      for (const u of lista) {
        const velho = antes.get(u.id);
        if (velho && igual(velho, u)) continue;
        const v = [u.id, u.companyId || null, u.username, u.name, u.role, u.active, u.mustChangePassword, u.hash, u.salt,
          Boolean(u.mfaEnabled), u.mfaSecret || null, u.mfaPending || null];
        if (!velho) await c.query(`INSERT INTO usuarios (id, empresa_id, usuario, nome, perfil, ativo, trocar_senha, senha_hash, senha_salt,
          mfa_ativo, mfa_segredo, mfa_pendente, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13::timestamptz, now()))`, [...v, u.createdAt || null]);
        else await c.query(`UPDATE usuarios SET empresa_id=$2, usuario=$3, nome=$4, perfil=$5, ativo=$6, trocar_senha=$7, senha_hash=$8,
          senha_salt=$9, mfa_ativo=$10, mfa_segredo=$11, mfa_pendente=$12, atualizado_em=now() WHERE id=$1`, v);
      }
      return resultado;
    }),
  };

  // ---------------------------------------------------------------- empresas
  const empresas = {
    listar: () => tx(SISTEMA, async c => (await c.query(SQL_EMPRESAS + ' ORDER BY e.criada_em, e.id')).rows.map(empresa)),
    obter: id => tx(SISTEMA, async c => { const r = (await c.query(SQL_EMPRESAS + ' WHERE e.id = $1', [id])).rows[0]; return r ? empresa(r) : null; }),
    atualizarLista: mudar => tx(SISTEMA, async c => {
      await c.query('LOCK TABLE empresas, assinaturas IN SHARE ROW EXCLUSIVE MODE');
      const lista = (await c.query(SQL_EMPRESAS + ' ORDER BY e.criada_em, e.id')).rows.map(empresa);
      const antes = new Map(lista.map(e => [e.id, structuredClone(e)]));
      const resultado = await mudar(lista);
      for (const e of lista) {
        const velho = antes.get(e.id);
        const campos = [e.id, e.name, e.city || '', e.uf, e.timeZone, e.contact || '', e.notes || '', e.state];
        if (!velho) await c.query(`INSERT INTO empresas (id, nome, cidade, uf, fuso_horario, contato, observacoes, situacao, criada_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()))`, [...campos, e.createdAt || null]);
        else if (!igual({ ...velho, subscription: null }, { ...e, subscription: null }))
          await c.query(`UPDATE empresas SET nome=$2, cidade=$3, uf=$4, fuso_horario=$5, contato=$6, observacoes=$7, situacao=$8, atualizada_em=now()
            WHERE id=$1`, campos);
        if (e.subscription && (!velho || !igual(velho.subscription, e.subscription))) {
          // Histórico: a assinatura vigente é encerrada e uma nova passa a valer.
          await c.query('UPDATE assinaturas SET vigente_ate = now() WHERE empresa_id = $1 AND vigente_ate IS NULL', [e.id]);
          const a = e.subscription;
          await c.query(`INSERT INTO assinaturas (id, empresa_id, plano, situacao, implantacao_centavos, mensalidade_centavos, proximo_vencimento, integracao_pagamento)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [crypto.randomUUID(), e.id, a.plan, a.status, a.setupCents ?? null, a.monthlyCents ?? null, a.nextDueDate || null, Boolean(a.paymentIntegration)]);
        }
      }
      return resultado;
    }),
  };

  // ---------------------------------------------------------------- solicitações
  async function mensagensDe(c, ids) {
    if (!ids.length) return new Map();
    const r = await c.query('SELECT * FROM mensagens_solicitacao WHERE solicitacao_id = ANY($1) ORDER BY criada_em, id', [ids]);
    const mapa = new Map(ids.map(id => [id, []]));
    for (const m of r.rows) mapa.get(m.solicitacao_id).push(m);
    return mapa;
  }
  const solicitacoes = {
    listar: (escopo, { donoId, situacao, busca } = {}) => tx(escopo, async c => {
      const r = await c.query(`SELECT * FROM solicitacoes WHERE ($1::uuid IS NULL OR cliente_id = $1) AND ($2::text IS NULL OR situacao = $2)
        ORDER BY atualizada_em DESC, id DESC LIMIT ${LIMITE_LISTA}`, [donoId || null, situacao || null]);
      let lista = r.rows.map(x => solicitacao(x));
      if (busca) { const b = normalizar(busca); lista = lista.filter(x => normalizar([x.subject, x.customerName, x.description, x.id].join(' ')).includes(b)); }
      return lista;
    }),
    obter: (escopo, id) => tx(escopo, async c => {
      const r = (await c.query('SELECT * FROM solicitacoes WHERE id = $1', [id])).rows[0];
      return r ? solicitacao(r, (await mensagensDe(c, [id])).get(id)) : null;
    }),
    contar: escopo => tx(escopo, async c => {
      const r = await c.query('SELECT situacao, count(*)::int AS n FROM solicitacoes GROUP BY situacao');
      const out = { total: 0, novo: 0, em_andamento: 0, aguardando_cliente: 0, resolvido: 0 };
      for (const x of r.rows) { out[x.situacao] = x.n; out.total += x.n; }
      return out;
    }),
    existeDoCliente: id => tx(SISTEMA, async c => (await c.query('SELECT 1 FROM solicitacoes WHERE cliente_id = $1 LIMIT 1', [id])).rowCount > 0),
    criar: item => tx(empresaEscopo(item.companyId), async c => {
      await c.query(`INSERT INTO solicitacoes (id, empresa_id, cliente_id, nome_cliente, assunto, descricao, situacao, prioridade, atribuida_a, criada_em, atualizada_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [item.id, item.companyId, item.ownerId, item.customerName, item.subject, item.description,
        item.status, item.priority, item.assignedTo, item.createdAt, item.updatedAt]);
      for (const m of item.messages) await inserirMensagem(c, item, m);
    }),
    alterar: (escopo, id, mudar) => tx(escopo, async c => {
      const r = (await c.query('SELECT * FROM solicitacoes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) return mudar(undefined);
      const x = solicitacao(r, (await mensagensDe(c, [id])).get(id));
      const antes = structuredClone(x);
      const resultado = await mudar(x);
      if (x.messages.length < antes.messages.length) throw new Error('Mensagens de solicitação não podem ser apagadas.');
      for (const m of x.messages.slice(antes.messages.length)) await inserirMensagem(c, x, m);
      if (!igual({ ...antes, messages: null }, { ...x, messages: null }))
        await c.query('UPDATE solicitacoes SET situacao=$2, prioridade=$3, atribuida_a=$4, atualizada_em=$5 WHERE id=$1',
          [id, x.status, x.priority, x.assignedTo, x.updatedAt]);
      return resultado;
    }),
  };
  function inserirMensagem(c, item, m) {
    return c.query(`INSERT INTO mensagens_solicitacao (id, empresa_id, solicitacao_id, autor_nome, autor_perfil, conteudo, interna, criada_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [m.id, item.companyId, item.id, String(m.author).slice(0, 80), m.role, m.content, Boolean(m.internal), m.createdAt]);
  }

  // ---------------------------------------------------------------- WhatsApp
  const exigirEmpresa = id => { if (!id) throw new Error('No PostgreSQL, WHATSAPP_EMPRESA_ID é obrigatório: toda conversa pertence a uma empresa.'); return id; };
  async function conversasCom(c, filtro, args, ultimas) {
    const r = await c.query(`SELECT * FROM conversas_whatsapp WHERE ${filtro} ORDER BY atualizada_em DESC NULLS LAST, id DESC LIMIT ${LIMITE_LISTA}`, args);
    if (!r.rows.length) return [];
    const m = await c.query(`SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY conversa_id ORDER BY criada_em DESC, id DESC) AS n
      FROM mensagens_whatsapp WHERE conversa_id = ANY($1)) t WHERE n <= $2 ORDER BY criada_em, id`, [r.rows.map(x => x.id), ultimas]);
    const mapa = new Map(r.rows.map(x => [x.id, []]));
    for (const x of m.rows) mapa.get(x.conversa_id).push(x);
    return r.rows.map(x => conversa(x, mapa.get(x.id)));
  }
  const conversas = {
    registrarEntrada: ({ telefone, nome, texto, idMeta, pedeAtendente }, empresaId) => tx(empresaEscopo(exigirEmpresa(empresaId)), async c => {
      if (idMeta && (await c.query('SELECT 1 FROM mensagens_whatsapp WHERE empresa_id = $1 AND id_meta = $2', [empresaId, idMeta])).rowCount) {
        const atual = (await c.query('SELECT modo FROM conversas_whatsapp WHERE empresa_id = $1 AND telefone = $2', [empresaId, telefone])).rows[0];
        return { modo: atual?.modo || 'robo', duplicada: true };
      }
      const conv = (await c.query(`INSERT INTO conversas_whatsapp (id, empresa_id, telefone, nome) VALUES ($1,$2,$3,$4)
        ON CONFLICT (empresa_id, telefone) DO UPDATE SET nome = CASE WHEN excluded.nome <> '' THEN excluded.nome ELSE conversas_whatsapp.nome END
        RETURNING *`, [crypto.randomUUID(), empresaId, telefone, String(nome || '').slice(0, 80)])).rows[0];
      const ins = await c.query(`INSERT INTO mensagens_whatsapp (id, empresa_id, conversa_id, de, autor, texto, id_meta)
        VALUES ($1,$2,$3,'cliente',$4,$5,$6) ON CONFLICT (empresa_id, id_meta) WHERE id_meta IS NOT NULL DO NOTHING RETURNING criada_em`,
        [crypto.randomUUID(), empresaId, conv.id, (conv.nome || 'Cliente').slice(0, 80), String(texto).slice(0, 4096), idMeta || null]);
      if (!ins.rowCount) return { modo: conv.modo, duplicada: true };
      await c.query(`UPDATE conversas_whatsapp SET atualizada_em = $2, ultima_do_cliente_em = $2,
        pedido_atendente = pedido_atendente OR (modo = 'robo' AND $3) WHERE id = $1`, [conv.id, ins.rows[0].criada_em, Boolean(pedeAtendente)]);
      return { modo: conv.modo, duplicada: false };
    }),
    registrarSaida: ({ telefone, texto, de, autor }, empresaId) => tx(empresaEscopo(exigirEmpresa(empresaId)), async c => {
      const conv = (await c.query('SELECT id FROM conversas_whatsapp WHERE empresa_id = $1 AND telefone = $2 FOR UPDATE', [empresaId, telefone])).rows[0];
      if (!conv) return;
      const r = await c.query(`INSERT INTO mensagens_whatsapp (id, empresa_id, conversa_id, de, autor, texto) VALUES ($1,$2,$3,$4,$5,$6) RETURNING criada_em`,
        [crypto.randomUUID(), empresaId, conv.id, de, String(autor || (de === 'robo' ? 'Robô' : 'Atendente')).slice(0, 80), String(texto).slice(0, 4096)]);
      await c.query('UPDATE conversas_whatsapp SET atualizada_em = $2 WHERE id = $1', [conv.id, r.rows[0].criada_em]);
    }),
    listar: escopo => tx(escopo, c => conversasCom(c, 'true', [], 1)),
    obter: (escopo, id) => tx(escopo, async c => (await conversasCom(c, 'id = $1', [id], MENSAGENS_POR_CONVERSA))[0] || null),
    alterar: (escopo, id, mudar) => tx(escopo, async c => {
      const r = (await c.query('SELECT * FROM conversas_whatsapp WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) return mudar(undefined);
      const x = conversa(r);
      const resultado = await mudar(x);
      await c.query('UPDATE conversas_whatsapp SET modo=$2, atendente_nome=$3, pedido_atendente=$4 WHERE id=$1',
        [id, x.modo, x.atendente ? String(x.atendente).slice(0, 80) : null, Boolean(x.pedidoAtendente)]);
      return resultado;
    }),
  };

  // ---------------------------------------------------------------- auditoria, login e contatos
  const auditoria = {
    registrar: (action, actor, detail = '') => tx(SISTEMA, c => c.query('INSERT INTO auditoria (acao, ator, detalhe) VALUES ($1,$2,$3)',
      [String(action).slice(0, 60), String(actor || '').slice(0, 30), String(detail).trim().slice(0, 200)])),
    recentes: (n = 100) => tx(SISTEMA, async c => (await c.query('SELECT * FROM auditoria ORDER BY em DESC, id DESC LIMIT $1', [n]))
      .rows.map(r => ({ at: iso(r.em), action: r.acao, actor: r.ator, detail: r.detalhe }))),
  };
  const tentativas = {
    registrar: ({ username, result, reason }) => tx(SISTEMA, c => c.query('INSERT INTO tentativas_login (usuario, resultado, motivo) VALUES ($1,$2,$3)',
      [String(username || '').trim().slice(0, 30).toLowerCase(), result, String(reason || '').trim().slice(0, 110)])),
    /** Últimos 7 dias, em ordem cronológica (como no arquivo). */
    listar: () => tx(SISTEMA, async c => (await c.query(`SELECT * FROM (SELECT * FROM tentativas_login WHERE em > now() - interval '7 days'
      ORDER BY em DESC, id DESC LIMIT 700) t ORDER BY em, id`)).rows.map(r => ({ at: iso(r.em), username: r.usuario, result: r.resultado, reason: r.motivo }))),
  };
  const contatos = {
    criar: (tipo, item) => tx(SISTEMA, c => {
      const { id, consent, createdAt, ...resto } = item;
      return c.query('INSERT INTO contatos_demonstracao (id, tipo, dados, consentimento, criado_em) VALUES ($1,$2,$3,$4,$5)', [id, tipo, resto, consent === true, createdAt]);
    }),
    listar: () => tx(SISTEMA, async c => (await c.query('SELECT * FROM contatos_demonstracao ORDER BY criado_em DESC LIMIT 500')).rows
      .map(r => ({ id: r.id, ...r.dados, consent: r.consentimento, createdAt: iso(r.criado_em), kind: r.tipo === 'orcamento' ? 'orçamento' : 'comercial' }))),
  };

  // ---------------------------------------------------------------- configuração do agente
  const configuracoes = {
    /** empresaId null = site público. Sem configuração própria da empresa, devolve null. */
    obter: (empresaId = null) => tx(SISTEMA, async c => {
      const r = (await c.query('SELECT * FROM configuracoes_agente WHERE empresa_id IS NOT DISTINCT FROM $1', [empresaId || null])).rows[0];
      return r ? configuracao(r) : null;
    }),
    salvar: (empresaId, cfg) => tx(SISTEMA, c => c.query(`INSERT INTO configuracoes_agente (id, empresa_id, nome, nome_assistente, area_atendimento, servicos, politica, contato, boas_vindas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (empresa_id) DO UPDATE SET nome=excluded.nome, nome_assistente=excluded.nome_assistente,
      area_atendimento=excluded.area_atendimento, servicos=excluded.servicos, politica=excluded.politica, contato=excluded.contato,
      boas_vindas=excluded.boas_vindas, atualizada_em=now()`, [crypto.randomUUID(), empresaId || null, cfg.name, cfg.assistantName, cfg.serviceArea || '',
      cfg.services, cfg.policy || '', cfg.contact || '', cfg.welcome || ''])),
  };

  // ---------------------------------------------------------------- dados da empresa
  // Sempre no escopo de quem pede (nunca SISTEMA): o RLS é a segunda barreira entre empresas.
  const dadosEmpresa = {
    obter: (escopo, empresaId) => tx(escopo, async c => {
      const r = (await c.query('SELECT * FROM dados_empresa WHERE empresa_id = $1', [empresaId])).rows[0];
      return r ? dadosDaEmpresa(r) : null;
    }),
    salvar: async (escopo, empresaId, d) => {
      if (escopo && escopo.perfil !== 'admin' && escopo.empresaId !== empresaId) throw Object.assign(new Error('Empresa fora do seu acesso.'), { status: 403 });
      return tx(escopo, async c => dadosDaEmpresa((await c.query(`INSERT INTO dados_empresa (empresa_id, horario, endereco, servicos, perguntas)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) ON CONFLICT (empresa_id) DO UPDATE SET horario=excluded.horario, endereco=excluded.endereco,
        servicos=excluded.servicos, perguntas=excluded.perguntas, atualizada_em=now() RETURNING *`,
      [empresaId, d.horario, d.endereco, JSON.stringify(d.servicos), JSON.stringify(d.perguntas)])).rows[0]));
    },
  };

  // ---------------------------------------------------------------- chamados de suporte técnico
  // Sempre no escopo de quem pede: o RLS deixa o atendimento abrir e ler os da própria empresa, e só o admin alterar.
  const chamados = {
    criar: async (escopo, item) => {
      if (!escopo || escopo.perfil === 'admin' || escopo.empresaId !== item.companyId) throw Object.assign(new Error('Empresa fora do seu acesso.'), { status: 403 });
      return tx(escopo, async c => chamado((await c.query(`INSERT INTO chamados (id, empresa_id, usuario_id, assunto, descricao, status, resposta, criado_em, atualizado_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [item.id, item.companyId, item.userId, item.assunto, item.descricao, item.status, item.resposta,
        item.criadoEm, item.atualizadoEm])).rows[0]));
    },
    listar: (escopo, { status } = {}) => tx(escopo, async c => (await c.query(`SELECT * FROM chamados WHERE ($1::text IS NULL OR status = $1)
      ORDER BY criado_em DESC, id DESC LIMIT ${LIMITE_LISTA}`, [status || null])).rows.map(chamado)),
    atualizar: async (escopo, id, { status, resposta }) => {
      if (!escopo || escopo.perfil !== 'admin') throw Object.assign(new Error('Seu perfil não tem acesso a esta função.'), { status: 403 });
      return tx(escopo, async c => {
        const r = (await c.query('UPDATE chamados SET status = $2, resposta = $3, atualizado_em = now() WHERE id = $1 RETURNING *', [id, status, resposta])).rows[0];
        return r ? chamado(r) : null;
      });
    },
  };

  // ---------------------------------------------------------------- sessões
  const sessoes = {
    criar: (chave, s) => tx(SISTEMA, c => c.query('INSERT INTO sessoes (chave, usuario_id, csrf, criada_em, vista_em) VALUES ($1,$2,$3,$4,$5)',
      [chave, s.id, s.csrf, new Date(s.created), new Date(s.seen)])),
    obter: chave => tx(SISTEMA, async c => {
      const r = (await c.query('SELECT * FROM sessoes WHERE chave = $1', [chave])).rows[0];
      return r ? { id: r.usuario_id, csrf: r.csrf, created: r.criada_em.getTime(), seen: r.vista_em.getTime() } : null;
    }),
    tocar: (chave, visto) => tx(SISTEMA, c => c.query('UPDATE sessoes SET vista_em = $2 WHERE chave = $1', [chave, new Date(visto)])),
    apagar: chave => tx(SISTEMA, c => c.query('DELETE FROM sessoes WHERE chave = $1', [chave])),
    apagarDoUsuario: id => tx(SISTEMA, c => c.query('DELETE FROM sessoes WHERE usuario_id = $1', [id])),
  };

  return {
    motor: 'postgres',
    async iniciar() {
      const v = await tx(SISTEMA, async c => (await c.query('SELECT max(versao)::int AS v FROM migracoes_esquema')).rows[0].v);
      if (v < 5) throw new Error(`Esquema do banco desatualizado (versão ${v}). Rode: node dados/migrar.js`);
      // Sessões vencidas (8 h de vida, 30 min sem uso) são apagadas na partida.
      await tx(SISTEMA, c => c.query("DELETE FROM sessoes WHERE criada_em < now() - interval '8 hours' OR vista_em < now() - interval '30 minutes'"));
    },
    encerrar: () => pool.end(),
    async saude() {
      const v = await tx(SISTEMA, async c => (await c.query('SHOW server_version')).rows[0].server_version);
      return { motor: 'postgres', descricao: `PostgreSQL ${v} com isolamento por empresa (RLS); backup diário pelo script de backup` };
    },
    usuarios, empresas, solicitacoes, conversas, auditoria, tentativas, contatos, configuracoes, dadosEmpresa, chamados, sessoes,
    /** Leitura em lote no formato dos arquivos (ferramentas de negócio e MCP). */
    lerColecao: nome => tx(SISTEMA, async c => {
      if (nome === 'empresas.json') return (await c.query(SQL_EMPRESAS + ' ORDER BY e.criada_em')).rows.map(empresa);
      if (nome === 'conversas-whatsapp.json') return conversasCom(c, 'true', [], MENSAGENS_POR_CONVERSA);
      if (nome === 'solicitacoes.json') {
        const r = (await c.query(`SELECT * FROM solicitacoes ORDER BY atualizada_em DESC LIMIT ${LIMITE_LISTA}`)).rows;
        const m = await mensagensDe(c, r.map(x => x.id));
        return r.map(x => solicitacao(x, m.get(x.id)));
      }
      throw new Error('Coleção desconhecida: ' + nome);
    }),
    _pool: pool,
  };
}

module.exports = { criar };
