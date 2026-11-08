'use strict';
// Verificação em duas etapas (ATENDE_MFA_ADMIN=1) e teto diário da IA.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function tetoDaIA() {
  // Módulo isolado, com fetch falso: nenhuma chamada real ao Gemini.
  process.env.GEMINI_API_KEY = 'chave-ficticia'; process.env.ATENDE_IA_LIMITE_DIA = '4'; process.env.ATENDE_IA_LIMITE_SITE_DIA = '2'; process.env.ATENDE_IA_LIMITE_DEMO_DIA = '1';
  delete require.cache[require.resolve(path.join(root, 'resposta.js'))];
  const r = require(path.join(root, 'resposta.js'));
  let chamadas = 0;
  const original = global.fetch;
  global.fetch = async () => { chamadas++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'resposta da IA' }] } }] }) }; };
  try {
    const c = { name: 'Empresa Fictícia', services: ['x'], serviceArea: '', policy: '', contact: '' };
    // Demonstração tem teto próprio e não gasta o teto do site.
    await r.aiAnswer('oi', [], null, 'demo');
    await assert.rejects(r.aiAnswer('oi', [], null, 'demo'), e => e.code === 'limite_ia', 'Demonstração para no teto próprio');
    assert.equal(await r.aiAnswer('oi', [], c, 'site'), 'resposta da IA');
    assert.equal(await r.aiAnswer('oi', [], c, 'site'), 'resposta da IA', 'Site não perde o que a demonstração gastou');
    await assert.rejects(r.aiAnswer('oi', [], c, 'site'), e => e.code === 'limite_ia', 'Site para no teto próprio');
    await r.aiAnswer('oi', [], c, 'whatsapp');
    await assert.rejects(r.aiAnswer('oi', [], c, 'whatsapp'), e => e.code === 'limite_ia', 'Teto geral vale para o WhatsApp');
    assert.equal(chamadas, 4, 'Acima do teto, o Gemini não é chamado');
    assert.deepEqual([r.usoDaIA().total, r.usoDaIA().site, r.usoDaIA().demo], [4, 2, 1]);
  } finally { global.fetch = original; }
}

(async () => {
  await tetoDaIA();
  const auth = require(path.join(root, 'auth.js'));
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-mfa-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const senha = 'Senha-Ficticia-2026!';
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...auth.hashPassword(senha) }]));
  const port = 39000 + Math.floor(Math.random() * 900), origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', ATENDE_MFA_ADMIN: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  let cookie = '', csrf = '';
  const pedir = async (rota, metodo = 'GET', corpo) => {
    const r = await fetch(origin + rota, { method: metodo, redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return r;
  };
  const entrar = async codigo => { const r = await pedir('/api/auth/login', 'POST', { username: 'admin.teste', password: senha, ...(codigo !== undefined ? { codigo } : {}) }); const b = await r.json(); if (b.csrf) csrf = b.csrf; return { status: r.status, b }; };
  try {
    let ok = false; for (let i = 0; i < 80 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/auth/me')).ok; } catch {} }
    assert.ok(ok, 'Servidor iniciou');
    let r = await entrar();
    assert.equal(r.status, 200); assert.equal(r.b.user.mfaRequired, true, 'Admin sem MFA precisa ativar');
    assert.equal((await pedir('/api/admin/users')).status, 403, 'Sem MFA, a administração fica bloqueada');
    assert.equal((await pedir('/admin')).status, 302, 'Página do admin redireciona para o acesso');
    const ini = await (await pedir('/api/auth/mfa/iniciar', 'POST', {})).json();
    const segredo = ini.segredo.replace(/\s/g, '');
    assert.match(ini.url, /^otpauth:\/\/totp\/Atende\.IA/);
    assert.equal((await pedir('/api/auth/mfa/ativar', 'POST', { codigo: '000000' === auth.totp(segredo, Math.floor(Date.now() / 30000)) ? '111111' : '000000' })).status, 400, 'Código errado não ativa');
    assert.equal((await pedir('/api/auth/mfa/ativar', 'POST', { codigo: auth.totp(segredo, Math.floor(Date.now() / 30000)) })).status, 200);
    assert.equal((await pedir('/api/admin/users')).status, 200, 'Com MFA ativa, a administração libera');
    const lista = await (await pedir('/api/admin/users')).json();
    assert.equal(lista.items[0].mfaEnabled, true, 'MFA gravada como ativa');
    assert.ok(!JSON.stringify(lista).includes(segredo), 'O segredo nunca sai na API');
    // Novo login: pede o código.
    await pedir('/api/auth/logout', 'POST', {}); cookie = ''; csrf = '';
    r = await entrar();
    assert.equal(r.status, 401); assert.equal(r.b.mfa, true, 'Senha certa sem código: pede o código');
    r = await entrar('123456' === auth.totp(segredo, Math.floor(Date.now() / 30000) + 1) ? '654321' : '123456');
    assert.equal(r.status, 401, 'Código errado é recusado');
    // Próximo passo de 30 s (o atual já foi usado na ativação e não vale de novo).
    r = await entrar(auth.totp(segredo, Math.floor(Date.now() / 30000) + 1));
    assert.equal(r.status, 200, 'Código válido entra');
    assert.equal(r.b.user.mfaRequired, false);
    const reuso = await entrar(auth.totp(segredo, Math.floor(Date.now() / 30000) + 1));
    assert.equal(reuso.status, 401, 'O mesmo código não serve duas vezes');
    console.log('OK: verificação em duas etapas (obrigatória para admin, ativação, login com código, sem reuso, segredo protegido) e teto diário da IA.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
