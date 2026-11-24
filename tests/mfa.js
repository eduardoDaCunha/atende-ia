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
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...auth.hashPassword(senha) },
    { id: crypto.randomUUID(), username: 'atend.teste', name: 'Atendente', role: 'atendimento', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...auth.hashPassword(senha) },
    // Admins sem MFA para os casos de bloqueio na ativação (não atrapalham o fluxo principal).
    ...['admin.dois', 'admin.tres', 'admin.quatro'].map(username => ({ id: crypto.randomUUID(), username, name: username, role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...auth.hashPassword(senha) }))]));
  const port = 39000 + Math.floor(Math.random() * 900), origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', ATENDE_MFA_ADMIN: '1', ATENDE_PROXY_CONFIAVEL: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  let cookie = '', csrf = '';
  // ip: simula outro visitante atrás do proxy (ATENDE_PROXY_CONFIAVEL=1); endereços de documentação.
  const pedir = async (rota, metodo = 'GET', corpo, ip) => {
    const r = await fetch(origin + rota, { method: metodo, redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) }, body: corpo && JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return r;
  };
  const entrar = async (codigo, ip) => { const r = await pedir('/api/auth/login', 'POST', { username: 'admin.teste', password: senha, ...(codigo !== undefined ? { codigo } : {}) }, ip); const b = await r.json(); if (b.csrf) csrf = b.csrf; return { status: r.status, b }; };
  try {
    let ok = false; for (let i = 0; i < 80 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/auth/me')).ok; } catch {} }
    assert.ok(ok, 'Servidor iniciou');
    // Duas sessões do mesmo admin (dois navegadores): B fica guardada; A segue no teste.
    let r = await entrar();
    const cookieB = cookie; cookie = ''; csrf = '';
    const comCookie = async (c, rota) => { const salvo = cookie; cookie = c; try { return (await pedir(rota)).status; } finally { cookie = salvo; } };
    r = await entrar();
    const cookieA = cookie, csrfA = csrf;
    assert.notEqual(cookieA, cookieB, 'Duas sessões diferentes');
    { const salvo = cookie; cookie = cookieB; const me = await (await pedir('/api/auth/me')).json(); cookie = salvo; assert.ok(me.user, 'Antes da ativação, a sessão B vale'); }
    assert.equal(r.status, 200); assert.equal(r.b.user.mfaRequired, true, 'Admin sem MFA precisa ativar');
    assert.equal((await pedir('/api/admin/users')).status, 403, 'Sem MFA, a administração fica bloqueada');
    assert.equal((await pedir('/admin')).status, 302, 'Página do admin redireciona para o acesso');
    const ini = await (await pedir('/api/auth/mfa/iniciar', 'POST', {})).json();
    const segredo = ini.segredo.replace(/\s/g, '');
    assert.match(ini.url, /^otpauth:\/\/totp\/Atende\.IA/);
    // Ativar exige a senha atual (sessão roubada não ativa o MFA); erro de senha não mexe no segredo pendente.
    const codigoAgora = () => auth.totp(segredo, Math.floor(Date.now() / 30000));
    const semSenha = await pedir('/api/auth/mfa/ativar', 'POST', { codigo: codigoAgora() });
    assert.equal(semSenha.status, 401, 'Sem senha atual: 401');
    assert.equal((await semSenha.json()).error, 'Senha atual incorreta.');
    assert.equal((await pedir('/api/auth/mfa/ativar', 'POST', { codigo: codigoAgora(), senhaAtual: 'errada' })).status, 401, 'Senha errada: 401');
    assert.equal((await (await pedir('/api/auth/me')).json()).user.mfaEnabled, false, 'Sem a senha certa, o MFA não fica ativo');
    assert.equal((await pedir('/api/auth/mfa/ativar', 'POST', { senhaAtual: senha, codigo: '000000' === codigoAgora() ? '111111' : '000000' })).status, 400, 'Código errado não ativa');
    // Mesmo segredo pendente de antes dos erros: o código dele ainda vale.
    const ativou = await pedir('/api/auth/mfa/ativar', 'POST', { senhaAtual: senha, codigo: codigoAgora() });
    assert.equal(ativou.status, 200);
    // Ativar o MFA derruba todas as sessões e abre uma nova (cookie e CSRF novos).
    const novo = await ativou.json();
    assert.ok(novo.csrf && novo.csrf !== csrfA, 'CSRF novo na resposta');
    assert.notEqual(cookie, cookieA, 'Cookie novo na resposta');
    assert.equal(await comCookie(cookieB, '/api/admin/users'), 401, 'A outra sessão deixa de valer');
    assert.equal(await comCookie(cookieA, '/api/admin/users'), 401, 'O cookie antigo desta sessão deixa de valer');
    assert.equal((await pedir('/api/auth/mfa/iniciar', 'POST', {})).status, 403, 'CSRF antigo recusado');
    csrf = novo.csrf;
    assert.equal((await pedir('/api/auth/mfa/iniciar', 'POST', {})).status, 409, 'CSRF novo aceito (MFA já ativa)');
    assert.equal((await pedir('/api/admin/users')).status, 200, 'Com MFA ativa, a sessão nova entra na administração');
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
    // Troca de senha (sessão do login acima): senha atual errada tem limite por conta e derruba a sessão.
    for (let i = 1; i <= 4; i++) assert.equal((await pedir('/api/auth/change-password', 'POST', { currentPassword: 'errada-' + i, newPassword: 'Outra-Senha-Ficticia-2026!' })).status, 401, 'Senha atual errada: 401');
    assert.equal((await pedir('/api/auth/change-password', 'POST', { currentPassword: 'errada-5', newPassword: 'Outra-Senha-Ficticia-2026!' })).status, 429, '5ª senha atual errada: 429');
    assert.equal((await (await pedir('/api/auth/me')).json()).user, null, 'Depois do limite, a sessão foi encerrada');
    // Código do MFA: limite por conta mesmo trocando de IP. O reuso acima já contou 1 erro.
    const errado = () => { const n = Math.floor(Date.now() / 30000), validos = [-1, 0, 1].map(d => auth.totp(segredo, n + d)); return ['111111', '222222', '333333', '444444'].find(c => !validos.includes(c)); };
    for (let i = 1; i <= 4; i++) assert.equal((await entrar(errado(), `198.51.100.${i}`)).status, 401, 'Código errado de outro IP: 401');
    r = await entrar(errado(), '198.51.100.9');
    assert.equal(r.status, 429, 'Com 5 códigos errados na conta, um IP novo também é barrado');
    assert.equal(auth.contaBloqueada('mfa:admin.teste'), false, 'O contador vive no processo do servidor, não no teste');
    // Troca de senha em paralelo: a senha certa chega enquanto os erros travam a conta e não pode passar.
    cookie = ''; csrf = '';
    const loginAtend = async () => { const resp = await pedir('/api/auth/login', 'POST', { username: 'atend.teste', password: senha }); const b = await resp.json(); if (b.csrf) csrf = b.csrf; return resp.status; };
    assert.equal(await loginAtend(), 200, 'Atendente entra');
    const nova = 'Nova-Senha-Ficticia-2026!';
    const lote = Array.from({ length: 12 }, (_, i) => pedir('/api/auth/change-password', 'POST', { currentPassword: 'errada-p' + i, newPassword: nova }));
    await wait(20);
    const certa = await pedir('/api/auth/change-password', 'POST', { currentPassword: senha, newPassword: nova });
    await Promise.all(lote);
    assert.notEqual(certa.status, 200, 'Senha certa no meio do lote não troca a senha depois da trava');
    cookie = ''; csrf = '';
    assert.equal(await loginAtend(), 200, 'A senha original continua valendo');
    // Ativação do MFA com outros admins: sessão própria por chamada, sem mexer no cookie/csrf acima.
    const sessao = async username => { const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: senha }) }); const b = await r.json(); assert.equal(r.status, 200, 'Entra ' + username); return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: b.csrf, mfaRequired: b.user.mfaRequired }; };
    const com = async (sess, rota, metodo = 'GET', corpo) => { const r = await fetch(origin + rota, { method: metodo, headers: { Cookie: sess.cookie, Origin: origin, 'X-CSRF-Token': sess.csrf, 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, b }; };
    const segredoDe = async sess => (await com(sess, '/api/auth/mfa/iniciar', 'POST', {})).b.segredo.replace(/\s/g, '');
    // 5 senhas erradas na ativação: 429 e todas as sessões caem; o MFA não fica ativo.
    const d1 = await sessao('admin.dois'), d2 = await sessao('admin.dois'), sd = await segredoDe(d1);
    for (let i = 1; i <= 4; i++) assert.equal((await com(d1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: 'errada-' + i, codigo: auth.totp(sd, Math.floor(Date.now() / 30000)) })).status, 401, 'Senha errada na ativação ' + i);
    assert.equal((await com(d1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: 'errada-5', codigo: auth.totp(sd, Math.floor(Date.now() / 30000)) })).status, 429, '5ª senha errada na ativação: 429');
    assert.equal((await com(d1, '/api/auth/me')).b.user, null, 'Sessão atual encerrada');
    assert.equal((await com(d2, '/api/auth/me')).b.user, null, 'Outra sessão também encerrada');
    assert.equal((await sessao('admin.dois')).mfaRequired, true, 'MFA continua desativado');
    // Em paralelo: as senhas erradas não passam de 5 tentativas verificadas e nada é ativado.
    const t1 = await sessao('admin.tres'), st = await segredoDe(t1);
    const paralelo = await Promise.all(Array.from({ length: 10 }, (_, i) => com(t1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: 'errada-p' + i, codigo: auth.totp(st, Math.floor(Date.now() / 30000)) })));
    assert.ok(paralelo.every(r => r.status !== 200), 'Nenhuma ativação em paralelo');
    assert.ok(paralelo.filter(r => r.b?.error === 'Senha atual incorreta.').length <= 4, 'No máximo 4 respostas "senha incorreta" antes da trava');
    assert.ok(paralelo.some(r => r.status === 429), 'A trava aparece no lote');
    assert.equal((await sessao('admin.tres')).mfaRequired, true, 'MFA continua desativado depois do lote');
    // Senha certa e 5 códigos errados na ativação: 429, mesmo com o código certo depois.
    const q1 = await sessao('admin.quatro'), sq = await segredoDe(q1);
    const erradoQ = () => { const n = Math.floor(Date.now() / 30000), validos = [-1, 0, 1].map(d => auth.totp(sq, n + d)); return ['111111', '222222', '333333', '444444'].find(c => !validos.includes(c)); };
    for (let i = 1; i <= 4; i++) assert.equal((await com(q1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: senha, codigo: erradoQ() })).status, 400, 'Código errado na ativação ' + i);
    assert.equal((await com(q1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: senha, codigo: erradoQ() })).status, 400, '5º código errado: 400 e trava');
    assert.equal((await com(q1, '/api/auth/mfa/ativar', 'POST', { senhaAtual: senha, codigo: auth.totp(sq, Math.floor(Date.now() / 30000)) })).status, 429, 'Travado: código certo também recebe 429');
    console.log('OK: verificação em duas etapas (obrigatória para admin, ativação com senha atual e limites de senha e de código, login com código, sem reuso, limite de códigos por conta, segredo protegido), limite na troca de senha e teto diário da IA.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
