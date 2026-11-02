/** Atende.IA — limpeza diária (retenção). Roda junto com o backup (implantacao/backup.sh).
 *
 *  Prazos aprovados (proposta da camada de dados, seção 6):
 *    tentativas de login: 90 dias | contatos do site: 180 dias | auditoria: 2 anos
 *    sessões vencidas: na hora
 *  Mensagens do WhatsApp NÃO são apagadas aqui: o prazo depende do contrato de cada cliente.
 *  Usa DATABASE_URL_DONO: auditoria e tentativas são só de inclusão para a aplicação.
 */
'use strict';
const REGRAS = [
  ['sessões vencidas', "DELETE FROM sessoes WHERE criada_em < now() - interval '8 hours' OR vista_em < now() - interval '30 minutes'"],
  ['tentativas de login (90 dias)', "DELETE FROM tentativas_login WHERE em < now() - interval '90 days'"],
  ['contatos do site (180 dias)', "DELETE FROM contatos_demonstracao WHERE criado_em < now() - interval '180 days'"],
  ['auditoria (2 anos)', "DELETE FROM auditoria WHERE em < now() - interval '2 years'"],
];

async function manutencao({ url = process.env.DATABASE_URL_DONO, log = console.log } = {}) {
  if (!url) throw new Error('Defina DATABASE_URL_DONO.');
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, application_name: 'atende-manutencao' });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.admin_geral', 'on', true)");
    const total = {};
    for (const [nome, sql] of REGRAS) total[nome] = (await c.query(sql)).rowCount;
    const resumo = Object.entries(total).map(([n, q]) => `${n}: ${q}`).join('; ');
    await c.query("INSERT INTO auditoria (acao, ator, detalhe) VALUES ('retencao_diaria', 'manutencao', $1)", [resumo.slice(0, 200)]);
    await c.query('COMMIT');
    log('Retenção: ' + resumo);
    return total;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { await c.end(); }
}

if (require.main === module) manutencao().catch(e => { console.error('Falha na manutenção:', e.message); process.exitCode = 1; });
module.exports = { manutencao };
