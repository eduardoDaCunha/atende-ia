/** Atende.IA — importa os arquivos JSON do protótipo para o PostgreSQL (uma vez, na mudança).
 *
 *  Uso:  ATENDE_DATA_DIR=C:\caminho\da\pasta\data  DATABASE_URL_DONO=postgres://...  node dados/importar-json.js
 *
 *  - Pode ser repetido: o que já existe (mesmo id) é mantido e não é duplicado.
 *  - Usuários, solicitações e conversas sem empresa vão para "Ambiente de testes anterior".
 *  - Cada registro é importado separadamente: um registro inválido é relatado e pulado,
 *    sem impedir o restante. Nada é apagado dos arquivos JSON.
 *  - O relatório mostra só contagens, nunca o conteúdo dos registros.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGADO = '00000000-0000-4000-8000-000000000001';

async function importar({ pasta = process.env.ATENDE_DATA_DIR, url = process.env.DATABASE_URL_DONO, log = console.log } = {}) {
  if (!pasta || !fs.existsSync(pasta)) throw new Error('Informe ATENDE_DATA_DIR com a pasta dos arquivos JSON.');
  if (!url) throw new Error('Defina DATABASE_URL_DONO.');
  const ler = (nome, padrao = []) => { const f = path.join(pasta, nome); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao; };
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, application_name: 'atende-importacao' });
  await c.connect();
  const relatorio = {};
  const conta = (tipo, ok) => { relatorio[tipo] ??= { importados: 0, jaExistiam: 0, pulados: 0 }; relatorio[tipo][ok]++; };
  // Cada registro num SAVEPOINT: falha em um não derruba a transação inteira.
  async function um(tipo, sql, valores) {
    await c.query('SAVEPOINT r');
    try {
      const r = await c.query(sql, valores);
      await c.query('RELEASE SAVEPOINT r');
      conta(tipo, r.rowCount ? 'importados' : 'jaExistiam');
      return r.rowCount > 0;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT r');
      conta(tipo, 'pulados');
      log(`  ${tipo}: registro pulado (${e.code || 'erro'}: ${e.message.split('\n')[0].slice(0, 120)})`);
      return false;
    }
  }
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.admin_geral', 'on', true)");
    const empresas = ler('empresas.json'), usuarios = ler('usuarios.json'), solicitacoes = ler('solicitacoes.json'), conversas = ler('conversas-whatsapp.json');
    const precisaLegado = usuarios.some(u => u.role !== 'admin' && !u.companyId) || solicitacoes.some(s => !s.companyId) || conversas.some(x => !x.companyId);
    if (precisaLegado && !empresas.some(e => e.id === LEGADO))
      empresas.push({ id: LEGADO, name: 'Ambiente de testes anterior', city: 'Não informado', uf: 'SC', timeZone: 'America/Sao_Paulo', contact: '',
        notes: 'Migração dos testes anteriores. Não é cliente real.', state: 'em_configuracao',
        subscription: { plan: 'essencial', status: 'teste', setupCents: 49000, monthlyCents: 19900, nextDueDate: null, paymentIntegration: false } });

    for (const e of empresas) {
      const nova = await um('empresas', `INSERT INTO empresas (id, nome, cidade, uf, fuso_horario, contato, observacoes, situacao, criada_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now())) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.name, e.city || '', e.uf || 'SC', e.timeZone || 'America/Sao_Paulo', e.contact || '', e.notes || '', e.state || 'em_configuracao', e.createdAt || null]);
      const a = e.subscription;
      if (nova && a) await um('assinaturas', `INSERT INTO assinaturas (id, empresa_id, plano, situacao, implantacao_centavos, mensalidade_centavos, proximo_vencimento, integracao_pagamento)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [crypto.randomUUID(), e.id, a.plan, a.status, a.setupCents ?? null, a.monthlyCents ?? null, a.nextDueDate || null, Boolean(a.paymentIntegration)]);
    }
    for (const u of usuarios) {
      const empresa = u.role === 'admin' ? null : (u.companyId || LEGADO);
      await um('usuarios', `INSERT INTO usuarios (id, empresa_id, usuario, nome, perfil, ativo, trocar_senha, senha_hash, senha_salt, mfa_ativo, mfa_segredo, criado_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::timestamptz, now())) ON CONFLICT (id) DO NOTHING`,
        [u.id, empresa, u.username, u.name, u.role, u.active !== false, Boolean(u.mustChangePassword), u.hash, u.salt,
          Boolean(u.mfaEnabled && u.mfaSecret), u.mfaEnabled ? u.mfaSecret : null, u.createdAt || null]);
    }
    for (const s of solicitacoes) {
      const empresa = s.companyId || LEGADO;
      const nova = await um('solicitacoes', `INSERT INTO solicitacoes (id, empresa_id, cliente_id, nome_cliente, assunto, descricao, situacao, prioridade, atribuida_a, criada_em, atualizada_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`, [s.id, empresa, s.ownerId, String(s.customerName || '').slice(0, 80), s.subject,
        s.description, s.status, s.priority || 'normal', s.assignedTo || null, s.createdAt, s.updatedAt || s.createdAt]);
      if (nova) for (const m of s.messages || [])
        await um('mensagens de solicitação', `INSERT INTO mensagens_solicitacao (id, empresa_id, solicitacao_id, autor_nome, autor_perfil, conteudo, interna, criada_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`, [m.id || crypto.randomUUID(), empresa, s.id, String(m.author || '').slice(0, 80), m.role,
          m.content, Boolean(m.internal), m.createdAt]);
    }
    for (const x of conversas) {
      const empresa = x.companyId || LEGADO;
      const nova = await um('conversas do WhatsApp', `INSERT INTO conversas_whatsapp (id, empresa_id, telefone, nome, modo, atendente_nome, pedido_atendente, criada_em, atualizada_em, ultima_do_cliente_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),$9,$10) ON CONFLICT DO NOTHING`, [x.id, empresa, x.telefone, String(x.nome || '').slice(0, 80),
        x.modo || 'robo', x.atendente || null, Boolean(x.pedidoAtendente), x.criadoEm || null, x.atualizadoEm || null, x.ultimaDoClienteEm || null]);
      if (nova) for (const m of x.mensagens || [])
        await um('mensagens do WhatsApp', `INSERT INTO mensagens_whatsapp (id, empresa_id, conversa_id, de, autor, texto, id_meta, criada_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [m.id || crypto.randomUUID(), empresa, x.id, m.de, String(m.autor || '').slice(0, 80),
          String(m.texto || '').slice(0, 4096), m.idMeta || null, m.em]);
    }
    // Registros só de inclusão: importados apenas se o banco ainda não tem nenhum (evita duplicar).
    if (!(await c.query('SELECT 1 FROM auditoria LIMIT 1')).rowCount)
      for (const a of ler('auditoria.json'))
        await um('auditoria', 'INSERT INTO auditoria (em, acao, ator, detalhe) VALUES ($1,$2,$3,$4)', [a.at, String(a.action).slice(0, 60), String(a.actor || '').slice(0, 30), String(a.detail || '').slice(0, 200)]);
    if (!(await c.query('SELECT 1 FROM tentativas_login LIMIT 1')).rowCount)
      for (const t of ler('tentativas-login.json'))
        await um('tentativas de login', 'INSERT INTO tentativas_login (em, usuario, resultado, motivo) VALUES ($1,$2,$3,$4)', [t.at, String(t.username || '').slice(0, 30), t.result, String(t.reason || '').slice(0, 110)]);
    for (const [arquivo, tipo] of [['leads-demonstracao.json', 'orcamento'], ['interesses-comerciais-teste.json', 'comercial']])
      for (const { id, consent, createdAt, ...resto } of ler(arquivo))
        await um('contatos do site', `INSERT INTO contatos_demonstracao (id, tipo, dados, consentimento, criado_em) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
          [id || crypto.randomUUID(), tipo, resto, consent === true, createdAt]);
    const cfg = ler('empresa.json', null);
    if (cfg) await um('configuração do agente', `INSERT INTO configuracoes_agente (id, empresa_id, nome, nome_assistente, area_atendimento, servicos, politica, contato, boas_vindas)
      VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (empresa_id) DO NOTHING`, [crypto.randomUUID(), cfg.name, cfg.assistantName, cfg.serviceArea || '',
      cfg.services, cfg.policy || '', cfg.contact || '', cfg.welcome || '']);
    for (const [empresaId, d] of Object.entries(ler('dados-empresa.json', {})))
      await um('dados da empresa', `INSERT INTO dados_empresa (empresa_id, horario, endereco, servicos, perguntas, atualizada_em)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,coalesce($6::timestamptz, now())) ON CONFLICT (empresa_id) DO NOTHING`,
      [empresaId, d.horario || '', d.endereco || '', JSON.stringify(d.servicos || []), JSON.stringify(d.perguntas || []), d.atualizadaEm || null]);
    for (const x of ler('chamados.json'))
      await um('chamados', `INSERT INTO chamados (id, empresa_id, usuario_id, assunto, descricao, status, resposta, criado_em, atualizado_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),coalesce($9::timestamptz, now())) ON CONFLICT (id) DO NOTHING`,
      [x.id, x.companyId, x.userId, x.assunto, x.descricao, x.status || 'aberto', x.resposta || '', x.criadoEm || null, x.atualizadoEm || null]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { await c.end(); }
  log('\nResumo da importação:');
  for (const [tipo, r] of Object.entries(relatorio)) log(`  ${tipo}: ${r.importados} importados, ${r.jaExistiam} já existiam, ${r.pulados} pulados`);
  return relatorio;
}

if (require.main === module) importar().catch(e => { console.error('Falha na importação:', e.message); process.exitCode = 1; });
module.exports = { importar };
