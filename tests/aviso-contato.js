'use strict';
// Aviso pelo Telegram (falso) de pedido de contato do site: só tipo, hora e link do painel, nunca dados
// do visitante; isca e pedidos recusados não avisam; falha do Telegram e aviso desligado não afetam o
// pedido; no máximo 10 avisos por hora, com uma linha de log; token nunca no log nem na mensagem.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
const FALSO = pathToFileURL(path.join(__dirname, 'telegram-falso.mjs')).href;
const TOKEN = '123456789:' + 'TokenFicticioDeTeste_'.repeat(2), CHAT = '-1000000000001';
const senha = 'Senha-Ficticia-2026!';
const PAINEL = '/atendimento#pedidos-site';
const LIMITE_LOG = 'Avisos de contato acima do limite por hora; pedidos continuam gravados';

// Valores marcadores únicos: nenhum deles pode aparecer na mensagem.
const ORCAMENTO = { name: 'NomeMarcadorVisitante', phone: '48 90000 1234', city: 'CidadeMarcadorVisitante', service: 'ServicoMarcadorVisitante', consent: true, site: '' };
const COMERCIAL = { company: 'EmpresaMarcadorVisitante', name: 'NomeMarcadorVisitante', contact: 'contato-marcador@exemplo.invalid', need: 'NecessidadeMarcadorVisitante', consent: true, site: '' };
const PROIBIDOS = ['NomeMarcador', '90000 1234', '900001234', 'CidadeMarcador', 'ServicoMarcador', 'EmpresaMarcador', 'contato-marcador', 'NecessidadeMarcador', '198.51.100', '203.0.113'];

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-aviso-contato-'));
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const aviso = require(path.join(base, 'aviso.js'));
  const servidores = [];
  let ipSeq = 0; const novoIp = () => `198.51.100.${++ipSeq}`; // um IP por pedido: o limite por IP (5/h) não interfere

  async function subir(nome, envExtra = {}) {
    const data = path.join(base, 'data-' + nome);
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin Fictício', role: 'admin', companyId: null,
      active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) }]));
    const port = 39500 + Math.floor(Math.random() * 1500), origin = `http://127.0.0.1:${port}`;
    const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', ATENDE_MFA_ADMIN: '', SITE_ORIGIN: '', ATENDE_PROXY_CONFIAVEL: '1', ...envExtra };
    // Nunca herda TELEGRAM_* nem WHATSAPP_* do ambiente de quem roda o teste.
    for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_') || (k.startsWith('TELEGRAM_') && !(k in envExtra))) delete env[k];
    const proc = spawn(process.execPath, ['--import', FALSO, 'server.js'], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], env });
    let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
    servidores.push(proc);
    let ok = false; for (let i = 0; i < 100 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/status')).ok; } catch {} }
    assert.ok(ok, `Servidor ${nome} iniciou`);
    const enviar = (rota, corpo) => fetch(origin + rota, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': novoIp() }, body: JSON.stringify(corpo) });
    async function pedidosGravados() {
      const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' }, body: JSON.stringify({ username: 'admin.teste', password: senha }) });
      assert.equal(r.status, 200, 'Login do admin');
      const cookie = r.headers.get('set-cookie').split(';')[0];
      const l = await fetch(origin + '/api/staff/leads', { headers: { Cookie: cookie, Origin: origin, 'X-Forwarded-For': '203.0.113.20' } });
      assert.equal(l.status, 200); return (await l.json()).items.length;
    }
    return { saida: () => log, enviar, pedidosGravados };
  }
  async function linhas(arquivo, n, ms = 4000) {
    for (let t = 0; t < ms; t += 50) {
      const l = (await fs.readFile(arquivo, 'utf8').catch(() => '')).split('\n').filter(Boolean);
      if (l.length >= n) return l.map(x => JSON.parse(x));
      await wait(50);
    }
    return (await fs.readFile(arquivo, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(x => JSON.parse(x));
  }
  const ocorrencias = (texto, trecho) => texto.split(trecho).length - 1;

  try {
    // ------------------------------------------------ aviso.js direto (sem rede)
    const texto = aviso.montarContato({ tipo: 'orcamento', criadoEm: '2026-11-16T17:35:00.000Z', painel: 'https://atende.exemplo-ficticio.com.br' + PAINEL });
    assert.equal(texto, 'Novo pedido de contato pelo site (orcamento)\nQuando: 16/11/2026 14:35 (horário de Brasília)\nVer no painel: https://atende.exemplo-ficticio.com.br/atendimento#pedidos-site', 'Texto exato, fuso de São Paulo');
    const desligado = aviso.criarAviso({});
    assert.equal(await desligado.contatoRecebido({ tipo: 'orcamento', criadoEm: new Date().toISOString(), painel: PAINEL }), false, 'Desligado: não envia e não rejeita');
    assert.equal(await desligado.contatoRecebido(), false, 'Sem argumentos: não rejeita');
    assert.equal(await aviso.criarAviso({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT }).contatoRecebido({ tipo: 'NomeMarcadorVisitante', criadoEm: new Date().toISOString(), painel: PAINEL }), false, 'Tipo fora da lista: não envia');

    // ------------------------------------------------ servidor A: aviso ligado
    const regA = path.join(base, 'telegram-a.jsonl');
    const A = await subir('a', { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TESTE_TELEGRAM_REGISTRO: regA });
    assert.equal((await A.enviar('/api/lead', ORCAMENTO)).status, 201, 'Orçamento válido');
    let env = await linhas(regA, 1);
    assert.equal(env.length, 1, '1 mensagem para o orçamento');
    assert.equal((await A.enviar('/api/commercial-lead', COMERCIAL)).status, 201, 'Comercial válido');
    env = await linhas(regA, 2);
    assert.equal(env.length, 2, '1 mensagem para o comercial');
    const textos = env.map(e => JSON.parse(e.corpo).text);
    assert.match(textos[0], /^Novo pedido de contato pelo site \(orcamento\)\nQuando: \d\d\/\d\d\/\d{4} \d\d:\d\d \(horário de Brasília\)\nVer no painel: \/atendimento#pedidos-site$/);
    assert.match(textos[1], /^Novo pedido de contato pelo site \(comercial\)\n/);
    for (const e of env) {
      for (const p of PROIBIDOS) assert.ok(!e.corpo.includes(p), `Mensagem sem dado do visitante (${p})`);
      assert.ok(!e.corpo.includes(TOKEN), 'Corpo da mensagem sem token');
      assert.equal(e.caminho, `/bot${TOKEN}/sendMessage`, 'Token só no caminho da API');
    }

    // Recusados e isca: nenhuma mensagem nova.
    assert.equal((await A.enviar('/api/lead', { ...ORCAMENTO, site: 'http://spam.example' })).status, 201, 'Isca responde como sucesso');
    assert.equal((await A.enviar('/api/commercial-lead', { ...COMERCIAL, site: 'x' })).status, 201, 'Isca (comercial)');
    assert.equal((await A.enviar('/api/lead', { ...ORCAMENTO, consent: undefined })).status, 400, 'Sem consentimento');
    assert.equal((await A.enviar('/api/commercial-lead', { ...COMERCIAL, need: 'x'.repeat(251) })).status, 400, 'Campo grande demais');
    assert.equal((await A.enviar('/api/lead', { ...ORCAMENTO, phone: 'abc' })).status, 400, 'Telefone inválido');
    await wait(400);
    assert.equal((await linhas(regA, 3, 300)).length, 2, 'Nenhuma mensagem para isca e recusados');

    // Limite: 10 avisos por hora. Completa os 10, depois mais 2 pedidos válidos.
    for (let i = 0; i < 8; i++) assert.equal((await A.enviar(i % 2 ? '/api/commercial-lead' : '/api/lead', i % 2 ? COMERCIAL : ORCAMENTO)).status, 201);
    assert.equal((await linhas(regA, 10)).length, 10, '10 avisos enviados');
    assert.equal((await A.enviar('/api/lead', ORCAMENTO)).status, 201, '11º pedido aceito');
    assert.equal((await A.enviar('/api/commercial-lead', COMERCIAL)).status, 201, '12º pedido aceito');
    await wait(400);
    assert.equal((await linhas(regA, 11, 300)).length, 10, '11º e 12º não enviam aviso');
    assert.equal(await A.pedidosGravados(), 12, 'Todos os pedidos válidos gravados, inclusive acima do limite de avisos');
    assert.equal(ocorrencias(A.saida(), LIMITE_LOG), 1, 'Uma linha de log por hora acima do limite');
    assert.ok(!A.saida().includes(TOKEN) && !A.saida().includes(CHAT), 'Log sem token e sem chat');
    for (const p of PROIBIDOS) assert.ok(!A.saida().includes(p), `Log sem dado do visitante (${p})`);

    // ------------------------------------------------ servidor B: Telegram falhando
    const regB = path.join(base, 'telegram-b.jsonl');
    const B = await subir('b', { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TESTE_TELEGRAM_REGISTRO: regB, TESTE_TELEGRAM_FALHA: '1' });
    assert.equal((await B.enviar('/api/lead', ORCAMENTO)).status, 201, 'Telegram falhando: resposta 201');
    assert.equal((await linhas(regB, 1)).length, 1, 'Envio tentado');
    for (let t = 0; t < 2000 && !B.saida().includes('Aviso de contato indisponível'); t += 50) await wait(50);
    assert.ok(B.saida().includes('Aviso de contato indisponível'), 'Falha vira uma linha de log');
    assert.equal(await B.pedidosGravados(), 1, 'Telegram falhando: pedido gravado');
    assert.ok(!B.saida().includes(TOKEN), 'Log da falha sem token');
    for (const p of PROIBIDOS) assert.ok(!B.saida().includes(p), `Log da falha sem dado do visitante (${p})`);

    // ------------------------------------------------ servidor C: aviso desligado (sem variáveis)
    const regC = path.join(base, 'telegram-c.jsonl');
    const C = await subir('c', { TESTE_TELEGRAM_REGISTRO: regC });
    assert.equal((await C.enviar('/api/lead', ORCAMENTO)).status, 201, 'Desligado: resposta 201');
    assert.equal((await C.enviar('/api/commercial-lead', COMERCIAL)).status, 201, 'Desligado: comercial 201');
    await wait(400);
    assert.equal((await linhas(regC, 1, 300)).length, 0, 'Desligado: nada enviado');
    assert.equal(await C.pedidosGravados(), 2, 'Desligado: pedidos gravados');
    assert.ok(!/indisponível|acima do limite|Error/.test(C.saida()), 'Desligado: nenhum erro no log');

    console.log('OK: aviso de contato do site — só tipo, hora e link, sem dados do visitante; isca e recusados não avisam; falha e aviso desligado não afetam o pedido; limite de 10 por hora com uma linha de log; token fora do log e da mensagem.');
  } finally {
    for (const p of servidores) p.kill();
    await wait(300); await fs.rm(base, { recursive: true, force: true }).catch(() => {});
  }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
