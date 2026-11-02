/** Atende.IA — aplica as migrações do banco (pasta dados/esquema), em ordem e uma única vez.
 *
 *  Uso:  DATABASE_URL_DONO=postgres://postgres:SENHA@127.0.0.1:5432/atende \
 *        ATENDE_APP_SENHA=senha-do-papel-da-aplicacao  node dados/migrar.js
 *
 *  DATABASE_URL_DONO é a conta dona do banco (cria tabelas). A aplicação usa outra conta,
 *  atende_app, sem poder de dono e sujeita ao isolamento por empresa (RLS).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function migrar({ url = process.env.DATABASE_URL_DONO, senhaApp = process.env.ATENDE_APP_SENHA, log = console.log } = {}) {
  if (!url) throw new Error('Defina DATABASE_URL_DONO (conta dona do banco).');
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, application_name: 'atende-migracao' });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(7310001)'); // duas migrações ao mesmo tempo esperam uma pela outra
    const tem = (await c.query("SELECT to_regclass('public.migracoes_esquema') IS NOT NULL AS t")).rows[0].t;
    const aplicadas = new Set(tem ? (await c.query('SELECT versao FROM migracoes_esquema')).rows.map(r => r.versao) : []);
    const pasta = path.join(__dirname, 'esquema');
    const arquivos = fs.readdirSync(pasta).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
    let novas = 0;
    for (const arquivo of arquivos) {
      const versao = Number(arquivo.slice(0, 3));
      if (aplicadas.has(versao)) continue;
      log(`Aplicando ${arquivo}...`);
      await c.query(fs.readFileSync(path.join(pasta, arquivo), 'utf8'));
      novas++;
    }
    if (senhaApp) {
      if (senhaApp.length < 16) throw new Error('ATENDE_APP_SENHA deve ter pelo menos 16 caracteres.');
      await c.query(`ALTER ROLE atende_app PASSWORD ${c.escapeLiteral(senhaApp)}`);
    }
    log(novas ? `Migrações aplicadas: ${novas}.` : 'Banco já está na versão mais recente.');
    return novas;
  } finally {
    await c.query('SELECT pg_advisory_unlock(7310001)').catch(() => {});
    await c.end();
  }
}

if (require.main === module) migrar().catch(e => { console.error('Falha na migração:', e.message); process.exitCode = 1; });
module.exports = { migrar };
