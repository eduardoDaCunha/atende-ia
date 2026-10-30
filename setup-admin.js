'use strict';
const readline = require('node:readline/promises');
const crypto = require('node:crypto');
const { read, update } = require('./store');
const { hashPassword, generatePassword, USERFILE } = require('./auth');
(async () => {
  const existing = await read(USERFILE);
  if (existing.length) { console.log('Já existem usuários. A criação de novas contas deve ser feita pelo painel do administrador.'); return; }
  const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
  try {
    console.log('=== Atende.IA v0.3 — criar primeiro administrador ===');
    const username = (await rl.question('Usuário (3-30 letras/números/ponto/traço): ')).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Nome de usuário inválido.');
    const name = (await rl.question('Nome para exibição (mínimo 2 caracteres): ')).trim();
    if (name.length < 2 || name.length > 80) throw new Error('Nome inválido.');
    const password = generatePassword();
    await update(USERFILE, users => {
      if (users.length) throw new Error('Administrador já existe.');
      users.push({ id:crypto.randomUUID(), username, name, role:'admin', active:true, mustChangePassword:true, createdAt:new Date().toISOString(), ...hashPassword(password) });
    });
    console.log('\nConta criada. Guarde estas informações em lugar seguro:');
    console.log('Usuário: ' + username);
    console.log('Senha provisória: ' + password);
    console.log('Troque a senha no primeiro acesso. Ela não será exibida novamente.');
  } finally { rl.close(); }
})().catch(err => { console.error('Erro:', err.message); process.exitCode = 1; });
