'use strict';
// Pedidos de contato do site: isca anti-robô, tamanho dos campos, limite por IP/hora, teto diário
// e nenhum IP gravado em disco.
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-contatos-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const senha = 'Senha-Ficticia-2026!';
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) }]));
  const port = 39000 + Math.floor(Math.random() * 900);
  const dominio = 'atende.exemplo-ficticio.com.br', origem = 'https://' + dominio;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', SITE_ORIGIN: origem, ATENDE_PROXY_CONFIAVEL: '1', ATENDE_LIMITE_CONTATOS_DIA: '3' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  const pedido = (rota, { metodo = 'GET', ip = '203.0.113.10', corpo, cookie } = {}) => new Promise((ok, falha) => {
    const texto = corpo ? JSON.stringify(corpo) : '';
    const req = http.request({ host: '127.0.0.1', port, path: rota, method: metodo, headers: { Host: dominio, Origin: origem, 'X-Forwarded-For': ip,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto), ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, ok: res.statusCode < 400, texto: b, json: j, cookie: [].concat(res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') }); });
    });
    req.on('error', falha); req.end(texto);
  });
  try {
    let pronto = false; for (let i = 0; i < 100 && !pronto; i++) { await wait(100); try { pronto = (await pedido('/api/status')).ok; } catch {} }
    assert.ok(pronto, 'Servidor no ar');
    const contato = (ip, extra = {}) => pedido('/api/commercial-lead', { metodo: 'POST', ip, corpo: { company: 'Empresa Ficticia', name: 'Nome Ficticio', contact: 'contato@exemplo.com', need: 'Automatizar atendimento', consent: true, site: '', ...extra } });
    const ipA = '198.51.100.31', ipB = '198.51.100.32', ipC = '198.51.100.33';
    // 1) Campo isca preenchido: resposta de sucesso, mas nada é gravado.
    assert.equal((await contato(ipA, { name: 'Robo Isca', site: 'http://spam.example' })).status, 201, 'Isca responde como sucesso');
    // 2) Campo maior que o limite (ou que não é texto) é recusado, não cortado.
    const grande = await contato(ipA, { need: 'x'.repeat(251) });
    assert.equal(grande.status, 400, 'Campo grande demais recusado'); assert.match(grande.json.error, /necessidade/);
    assert.equal((await contato(ipA, { name: ['lista'] })).status, 400, 'Campo que não é texto recusado');
    // 3) Limite por IP: 5 pedidos por hora (contando os recusados acima); o 6º é barrado.
    assert.equal((await contato(ipA)).status, 201);
    assert.equal((await contato(ipA)).status, 201);
    assert.equal((await contato(ipA)).status, 429, '6º pedido do mesmo IP na hora é barrado');
    // 4) Teto global por dia (3 neste teste): outro IP passa até o teto; depois todos param.
    assert.equal((await contato(ipB)).status, 201, 'Outro IP não herda o limite do primeiro');
    assert.equal((await contato(ipC)).status, 429, 'Teto global do dia atingido');
    // 5) Gravados só os 3 válidos; nada da isca; nenhum IP em disco.
    const adm = await pedido('/api/auth/login', { metodo: 'POST', ip: '203.0.113.20', corpo: { username: 'admin.teste', password: senha } });
    assert.equal(adm.status, 200);
    const lista = await pedido('/api/staff/leads', { ip: '203.0.113.20', cookie: adm.cookie });
    assert.equal(lista.status, 200);
    assert.equal(lista.json.items.length, 3, 'Só os pedidos válidos foram gravados');
    assert.ok(!lista.texto.includes('Robo Isca') && !lista.texto.includes('198.51.100'), 'Sem isca e sem IP nos pedidos');
    for (const arq of await fs.readdir(data)) {
      const caminho = path.join(data, arq);
      if (!(await fs.stat(caminho)).isFile()) continue;
      assert.ok(!(await fs.readFile(caminho, 'utf8')).includes('198.51.100.3'), 'IP não gravado em ' + arq);
    }
    console.log('OK: pedidos de contato com isca, limite de tamanho, limite por IP/hora, teto diário e sem IP em disco.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
