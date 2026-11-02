// Só para testes: roda as suítes do servidor contra o PostgreSQL.
// Carregado com NODE_OPTIONS=--import antes do server.js. Para cada pasta de dados de teste,
// cria um banco próprio (atende_t_<hash>), aplica as migrações, importa os JSON fictícios
// que o teste gerou e aponta DATABASE_URL para a conta da aplicação (atende_app).
// Requer TESTE_PG_DONO=postgres://dono:senha@127.0.0.1:5432/postgres e TESTE_PG_APP_SENHA.
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';

const exigir = createRequire(path.join(process.cwd(), 'server.js')); // a cópia do servidor que o teste montou
const dono = process.env.TESTE_PG_DONO, senhaApp = process.env.TESTE_PG_APP_SENHA;
const pasta = process.env.ATENDE_DATA_DIR;
const ehServidor = /server\.js$/.test(process.argv[1] || '');
if (ehServidor && dono && senhaApp && pasta) {
  const { Client } = exigir('pg');
  const nome = 'atende_t_' + crypto.createHash('sha256').update(path.resolve(pasta)).digest('hex').slice(0, 16);
  const raiz = new Client({ connectionString: dono });
  await raiz.connect();
  const existe = (await raiz.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome])).rowCount > 0;
  if (!existe) await raiz.query(`CREATE DATABASE ${nome}`);
  await raiz.end();
  const url = new URL(dono); url.pathname = '/' + nome;
  const silencio = process.env.TESTE_PG_LOG ? (m => process.stderr.write(m + '\n')) : () => {};
  if (!existe) {
    await exigir('./dados/migrar.js').migrar({ url: url.toString(), senhaApp, log: silencio });
    await exigir('./dados/importar-json.js').importar({ pasta, url: url.toString(), log: silencio });
  }
  const app = new URL(url); app.username = 'atende_app'; app.password = senhaApp;
  process.env.ATENDE_BANCO = 'postgres';
  process.env.DATABASE_URL = app.toString();
}
