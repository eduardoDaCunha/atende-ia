'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
// Dados permanentes fora da pasta de cada versao no Windows.
// Em testes isolados e outras plataformas, usa ROOT/data.
const DATA = path.resolve(process.env.ATENDE_DATA_DIR ||
  (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'AtendeIA', 'data')
    : path.join(ROOT, 'data')));
const queues = new Map();
function filename(name) {
  if (!/^[a-z0-9-]+\.json$/i.test(name)) throw new Error('Arquivo inválido');
  return path.join(DATA, name);
}
async function read(name, fallback = []) {
  try { return JSON.parse(await fs.readFile(filename(name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return structuredClone(fallback); throw e; }
}
async function write(name, value) {
  await fs.mkdir(DATA, { recursive: true, mode: 0o700 });
  const target = filename(name);
  const temp = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function update(name, mutate, fallback = []) {
  const previous = queues.get(name) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const data = await read(name, fallback);
    const result = await mutate(data);
    await write(name, data);
    return result;
  });
  queues.set(name, current);
  try { return await current; }
  finally { if (queues.get(name) === current) queues.delete(name); }
}
// Impede que duas versoes do servidor escrevam simultaneamente na mesma base JSON.
// O arquivo de trava nao contem credenciais e pode ser recuperado apos travamento.
function acquireServerLock() {
  fsSync.mkdirSync(DATA, {recursive:true, mode:0o700});
  const lockFile=path.join(DATA,'.servidor.lock');
  for(let attempt=0;attempt<3;attempt++) {
    try {
      fsSync.writeFileSync(lockFile, JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}), {encoding:'utf8',flag:'wx',mode:0o600});
      let released=false;
      return () => {
        if(released)return;
        released=true;
        try {
          const value=JSON.parse(fsSync.readFileSync(lockFile,'utf8'));
          if(value.pid===process.pid)fsSync.unlinkSync(lockFile);
        } catch(e) { if(e.code!=='ENOENT') console.error('Nao foi possivel limpar a trava do servidor:',e.message); }
      };
    } catch(e) {
      if(e.code!=='EEXIST')throw e;
      let value;
      try{value=JSON.parse(fsSync.readFileSync(lockFile,'utf8'));}
      catch{throw Error('Arquivo de trava invalido. Confira se outro Atende.IA esta em execucao antes de remover '+lockFile);}
      if(!Number.isInteger(value.pid)||value.pid<=0)throw Error('Trava sem PID valido. Verifique manualmente '+lockFile);
      try {
        process.kill(value.pid,0);
        throw Error('Outra versao do Atende.IA parece estar aberta (PID '+value.pid+'). Feche-a antes de iniciar esta.');
      } catch(err) {
        if(err.code!=='ESRCH')throw err;
      }
      // Processo antigo nao existe mais: recupera a trava obsoleta.
      fsSync.unlinkSync(lockFile);
    }
  }
  throw Error('Nao foi possivel obter a trava de dados.');
}

module.exports = { read, update, write, DATA, ROOT, acquireServerLock };
