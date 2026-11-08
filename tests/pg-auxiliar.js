'use strict';
// Auxiliar do RODAR-TESTES-POSTGRES.bat (evita "node -e" com aspas dentro do .bat).
//   node tests/pg-auxiliar.js porta   -> sai com 0 se o banco de TESTE_PG_DONO responde na porta, 1 se não
//   node tests/pg-auxiliar.js limpar  -> apaga os bancos temporários atende_t_* criados pelos testes
// Nunca imprime a URL nem a senha.
const net = require('node:net');
const url = new URL(process.env.TESTE_PG_DONO || 'postgres://127.0.0.1:55432/postgres');
const comando = process.argv[2];

if (comando === 'porta') {
  const s = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
  s.setTimeout(3000, () => { s.destroy(); process.exit(1); });
  s.on('connect', () => { s.end(); process.exit(0); });
  s.on('error', () => process.exit(1));
} else if (comando === 'limpar') {
  (async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.TESTE_PG_DONO });
    await c.connect();
    const bancos = (await c.query("SELECT datname FROM pg_database WHERE starts_with(datname, 'atende_t_')")).rows.map(r => r.datname);
    // Nome conferido antes de ir para o DROP (não aceita parâmetro): só atende_t_ + hexadecimal.
    for (const nome of bancos) if (/^atende_t_[0-9a-f]+$/.test(nome)) await c.query(`DROP DATABASE ${nome} WITH (FORCE)`);
    await c.end();
    console.log(`Bancos temporários apagados: ${bancos.length}`);
  })().catch(e => { console.error('Não foi possível apagar os bancos temporários:', e.code || 'erro'); process.exit(1); });
} else {
  console.error('Uso: node tests/pg-auxiliar.js porta|limpar');
  process.exit(2);
}
