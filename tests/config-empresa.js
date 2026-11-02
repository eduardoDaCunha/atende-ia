'use strict';
// Configuração do agente por empresa: cada empresa tem a sua; o site público mantém a dele;
// só o administrador altera; empresa inexistente é recusada.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-cfg-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const senha = 'Senha-Ficticia-2026!', A = crypto.randomUUID();
  const u = (username, role, companyId) => ({ id: crypto.randomUUID(), username, name: username, role, companyId, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) });
  await fs.writeFile(path.join(data, 'empresas.json'), JSON.stringify([{ id: A, name: 'Doceria Fictícia', city: 'Cidade Fictícia', uf: 'SC', timeZone: 'America/Sao_Paulo', contact: '', notes: '', state: 'ativa',
    subscription: { plan: 'essencial', status: 'teste', setupCents: 0, monthlyCents: 0, nextDueDate: null, paymentIntegration: false }, createdAt: new Date().toISOString() }]));
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([u('admin.teste', 'admin', null), u('ana.teste', 'atendimento', A)]));
  const port = 39000 + Math.floor(Math.random() * 900), origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  try {
    let ok = false; for (let i = 0; i < 80 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/auth/me')).ok; } catch {} }
    assert.ok(ok, 'Servidor iniciou');
    async function entrar(username) {
      const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: senha }) });
      assert.equal(r.status, 200); const { csrf } = await r.json();
      const cookie = r.headers.get('set-cookie').split(';')[0];
      return (rota, metodo = 'GET', corpo) => fetch(origin + rota, { method: metodo, headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
    }
    const admin = await entrar('admin.teste');
    const site = await (await admin('/api/admin/config')).json();
    assert.equal(site.propria, true);
    let r = await (await admin('/api/admin/config?empresa=' + A)).json();
    assert.equal(r.propria, false, 'Empresa sem configuração própria parte da do site');
    assert.equal(r.config.name, site.config.name);
    const cfg = { name: 'Doceria Fictícia', assistantName: 'Assistente Doce', serviceArea: 'Cidade Fictícia', services: ['Bolos', 'Doces'], policy: '', contact: '', welcome: 'Olá!', companyId: A, confirmed: true };
    assert.equal((await admin('/api/admin/config', 'PUT', cfg)).status, 200);
    r = await (await admin('/api/admin/config?empresa=' + A)).json();
    assert.equal(r.propria, true); assert.equal(r.config.assistantName, 'Assistente Doce'); assert.deepEqual(r.config.services, ['Bolos', 'Doces']);
    assert.equal((await (await admin('/api/admin/config')).json()).config.name, site.config.name, 'A configuração do site não mudou');
    assert.equal((await admin('/api/admin/config', 'PUT', { ...cfg, companyId: crypto.randomUUID() })).status, 400, 'Empresa inexistente é recusada');
    assert.equal((await admin('/api/admin/config?empresa=' + crypto.randomUUID())).status, 404);
    const ana = await entrar('ana.teste');
    assert.equal((await ana('/api/admin/config?empresa=' + A)).status, 403, 'Atendimento não acessa a configuração');
    assert.equal((await ana('/api/admin/config', 'PUT', cfg)).status, 403);
    console.log('OK: configuração do agente por empresa — própria, herdada do site, só admin, empresa inexistente recusada.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
