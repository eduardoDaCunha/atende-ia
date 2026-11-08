'use strict';
// Bloqueio de login por usuário + IP: um atacante não trava o login do dono, que entra de outro IP.
// Ataque espalhado por muitos IPs gera atraso progressivo, nunca bloqueio total. Sem IP no painel.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-bloqueio-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const senha = 'Senha-Ficticia-2026!';
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) }]));
  const port = 39000 + Math.floor(Math.random() * 900);
  const dominio = 'atende.exemplo-ficticio.com.br', origem = 'https://' + dominio;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', SITE_ORIGIN: origem, ATENDE_PROXY_CONFIAVEL: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  // IP do visitante pelo X-Forwarded-For (como atrás do Caddy), para simular vários IPs.
  const pedido = (rota, { metodo = 'GET', ip = '203.0.113.10', corpo, cookie } = {}) => new Promise((ok, falha) => {
    const texto = corpo ? JSON.stringify(corpo) : '';
    const req = http.request({ host: '127.0.0.1', port, path: rota, method: metodo, headers: { Host: dominio, Origin: origem, 'X-Forwarded-For': ip,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto), ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, ok: res.statusCode < 400, texto: b, json: j, retryAfter: res.headers['retry-after'], cookie: [].concat(res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') }); });
    });
    req.on('error', falha); req.end(texto);
  });
  try {
    let pronto = false; for (let i = 0; i < 100 && !pronto; i++) { await wait(100); try { pronto = (await pedido('/api/status')).ok; } catch {} }
    assert.ok(pronto, 'Servidor no ar');
    const login = (ip, password, username = 'admin.teste') => pedido('/api/auth/login', { metodo: 'POST', ip, corpo: { username, password } });
    // 1) 5 senhas erradas do IP do atacante travam só esse IP, mesmo com a senha certa depois.
    for (let i = 0; i < 5; i++) assert.equal((await login('198.51.100.66', 'errada-' + i)).status, 401, 'Erro ' + (i + 1));
    assert.equal((await login('198.51.100.66', senha)).status, 429, 'IP do atacante bloqueado, mesmo com a senha certa');
    // 2) O dono, em outro IP, entra normalmente.
    const dono = await login('203.0.113.20', senha);
    assert.equal(dono.status, 200, 'Senha certa em outro IP entra');
    // 3) O painel lista a conta bloqueada, sem mostrar IP.
    const seg = await pedido('/api/admin/security', { ip: '203.0.113.20', cookie: dono.cookie });
    assert.equal(seg.status, 200);
    assert.ok(seg.json.blocked.some(b => b.username === 'admin.teste'), 'Conta aparece como bloqueada (no IP do atacante)');
    assert.ok(!seg.texto.includes('198.51.100.66'), 'Lista de bloqueios não expõe IP');
    // 4) Muitos IPs contra a mesma conta: atraso a partir do 10º erro, nunca bloqueio total.
    const t0 = Date.now(); assert.equal((await login('192.0.2.200', 'errada', 'alvo.teste')).status, 401); const normal = Date.now() - t0;
    for (let i = 1; i < 10; i++) assert.equal((await login('192.0.2.' + i, 'errada', 'alvo.teste')).status, 401);
    const t1 = Date.now(); const atrasado = await login('192.0.2.50', 'errada', 'alvo.teste'); const demora = Date.now() - t1;
    assert.equal(atrasado.status, 401, 'Muitos IPs não geram bloqueio total da conta');
    // O 11º erro espera 500 ms; mínimo absoluto, pois a 1ª chamada (referência) pode vir lenta por aquecimento.
    assert.ok(demora >= 480, `Atraso progressivo aplicado (${normal} ms -> ${demora} ms)`);
    // 5) No máximo 4 logins atrasados ao mesmo tempo: os demais recebem 429 na hora, com Retry-After.
    const t2 = Date.now();
    const juntos = await Promise.all([1, 2, 3, 4, 5, 6].map(i => login('192.0.2.' + (100 + i), 'errada', 'alvo.teste').then(r => ({ ...r, ms: Date.now() - t2 }))));
    const recusados = juntos.filter(r => r.status === 429), esperaram = juntos.filter(r => r.status === 401);
    assert.equal(esperaram.length, 4, 'Só 4 logins esperam o atraso ao mesmo tempo');
    assert.equal(recusados.length, 2, 'Os excedentes são recusados');
    assert.ok(recusados.every(r => r.retryAfter === '60'), 'Recusa com Retry-After');
    assert.ok(Math.max(...recusados.map(r => r.ms)) < Math.min(...esperaram.map(r => r.ms)), 'Recusa vem na hora, antes dos atrasados');
    // 6) Unidade: o desbloqueio pelo admin limpa todos os IPs do usuário.
    const auth = require(path.join(base, 'auth.js'));
    auth.fail('u.teste', 'a'); for (let i = 0; i < 5; i++) auth.fail('u.teste', 'b');
    assert.equal(auth.locked('u.teste', 'a'), false); assert.equal(auth.locked('u.teste', 'b'), true);
    assert.equal(auth.unblock('u.teste'), true); assert.equal(auth.locked('u.teste', 'b'), false); assert.equal(auth.loginDelay('u.teste'), 0);
    console.log('OK: bloqueio por usuário + IP, dono entra de outro IP, atraso progressivo sem bloqueio total, sem IP no painel.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
