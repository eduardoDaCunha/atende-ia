'use strict';
// Produção atrás do Caddy: domínio aceito, cookie com Secure, origem estranha recusada e
// limite de login POR VISITANTE (IP do X-Forwarded-For), não um limite único para todos.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-proxy-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const senha = 'Senha-Ficticia-2026!';
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) }]));
  const port = 39000 + Math.floor(Math.random() * 900), local = `http://127.0.0.1:${port}`;
  const dominio = 'atende.exemplo-ficticio.com.br', origem = 'https://' + dominio;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', SITE_ORIGIN: origem, ATENDE_PROXY_CONFIAVEL: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  // http.request em vez de fetch: o fetch não deixa trocar o cabeçalho Host (como faz o Caddy).
  const http = require('node:http');
  const pedido = (rota, { metodo = 'GET', host = dominio, origin = origem, ip = '203.0.113.10', corpo } = {}) => new Promise((ok, falha) => {
    const texto = corpo ? JSON.stringify(corpo) : '';
    const req = http.request({ host: '127.0.0.1', port, path: rota, method: metodo, headers: { Host: host, Origin: origin, 'X-Forwarded-For': ip,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => ok({ status: res.statusCode, ok: res.statusCode < 400, headers: { get: n => [].concat(res.headers[n.toLowerCase()] || []).join('\n') }, json: async () => JSON.parse(b) }));
    });
    req.on('error', falha); req.end(texto);
  });
  try {
    let ok = false; for (let i = 0; i < 80 && !ok; i++) { await wait(100); try { ok = (await pedido('/api/status')).ok; } catch {} }
    assert.ok(ok, 'Servidor aceita o domínio configurado');
    assert.equal((await pedido('/api/status', { host: 'outro-dominio.com' })).status, 403, 'Outro domínio é recusado');
    assert.equal((await (await pedido('/api/status')).json()).local, false);
    const r = await pedido('/api/auth/login', { metodo: 'POST', corpo: { username: 'admin.teste', password: senha } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /; Secure/, 'Cookie de sessão com Secure em HTTPS');
    assert.equal((await pedido('/api/auth/login', { metodo: 'POST', origin: 'https://malicioso.example', corpo: {} })).status, 403, 'Origem estranha recusada');
    // 40 tentativas por 15 min por visitante: o 41º pedido do mesmo IP é barrado, outro IP não.
    let ultimo;
    for (let i = 0; i < 41; i++) ultimo = (await pedido('/api/auth/login', { metodo: 'POST', ip: '198.51.100.7, 203.0.113.77', corpo: { username: 'x' + i, password: 'errada' } })).status;
    assert.equal(ultimo, 429, 'Mesmo visitante é limitado');
    assert.equal((await pedido('/api/auth/login', { metodo: 'POST', ip: '203.0.113.78', corpo: { username: 'y', password: 'errada' } })).status, 401, 'Outro visitante não herda o bloqueio');
    console.log('OK: produção atrás do proxy — domínio, cookie Secure, origem e limite de login por visitante.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
