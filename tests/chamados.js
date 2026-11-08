'use strict';
// Chamados de suporte técnico: só o atendimento abre e vê os da própria empresa; só o admin responde;
// entrada validada; limites por usuário e global; aviso pelo Telegram (falso) sem a descrição;
// falha do Telegram não impede o chamado; configuração incompleta só desliga o aviso; auditoria sem conteúdo.
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
const senha = 'Senha-Ficticia-2026!', A = crypto.randomUUID(), B = crypto.randomUUID();
const ROTA = '/api/staff/chamados', ADMIN = '/api/admin/chamados';

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-chamados-'));
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const aviso = require(path.join(base, 'aviso.js'));
  const servidores = [];

  const emp = (id, name) => ({ id, name, city: 'Cidade Fictícia', uf: 'SC', timeZone: 'America/Sao_Paulo', contact: '', notes: '', state: 'ativa',
    subscription: { plan: 'essencial', status: 'teste', setupCents: 0, monthlyCents: 0, nextDueDate: null, paymentIntegration: false }, createdAt: new Date().toISOString() });
  const u = (username, name, role, companyId) => ({ id: crypto.randomUUID(), username, name, role, companyId, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) });

  /** Sobe um servidor com pasta de dados própria. Devolve { origin, saida(), entrar(usuario) }. */
  async function subir(nome, envExtra = {}) {
    const data = path.join(base, 'data-' + nome);
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'empresas.json'), JSON.stringify([emp(A, 'Clínica Fictícia A'), emp(B, 'Clínica Fictícia B')]));
    await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([u('admin.teste', 'Admin Fictício', 'admin', null), u('ana.a', 'Ana Fictícia', 'atendimento', A),
      u('carla.a', 'Carla Fictícia', 'atendimento', A), u('bruno.b', 'Bruno Fictício', 'atendimento', B), u('cliente.a', 'Cliente Fictício', 'cliente', A)]));
    const port = 38000 + Math.floor(Math.random() * 1500), origin = `http://127.0.0.1:${port}`;
    const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', ATENDE_MFA_ADMIN: '', SITE_ORIGIN: '', ...envExtra };
    for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_') || (k.startsWith('TELEGRAM_') && !(k in envExtra))) delete env[k];
    const proc = spawn(process.execPath, ['--import', FALSO, 'server.js'], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], env });
    let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
    servidores.push(proc);
    let ok = false; for (let i = 0; i < 100 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/auth/me')).ok; } catch {} }
    assert.ok(ok, `Servidor ${nome} iniciou`);
    async function entrar(username) {
      const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: senha }) });
      assert.equal(r.status, 200, username); const { csrf } = await r.json();
      const cookie = r.headers.get('set-cookie').split(';')[0];
      return (rota, metodo = 'GET', corpo, comCsrf = true) => fetch(origin + rota, { method: metodo, redirect: 'manual',
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...(comCsrf ? { 'X-CSRF-Token': csrf } : {}) }, body: corpo && JSON.stringify(corpo) });
    }
    return { origin, saida: () => log, entrar };
  }
  async function linhas(arquivo, n, ms = 4000) {
    for (let t = 0; t < ms; t += 50) {
      const texto = await fs.readFile(arquivo, 'utf8').catch(() => '');
      const l = texto.split('\n').filter(Boolean);
      if (l.length >= n) return l.map(x => JSON.parse(x));
      await wait(50);
    }
    return (await fs.readFile(arquivo, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(x => JSON.parse(x));
  }
  const brasilia = iso => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(',', '');

  try {
    // ------------------------------------------------ aviso.js direto (sem rede)
    assert.equal(aviso.configuracao({}).ativo, false, 'Sem variáveis: desligado');
    assert.equal(aviso.configuracao({ TELEGRAM_BOT_TOKEN: TOKEN }).ativo, false, 'Só o token: desligado');
    assert.equal(aviso.configuracao({ TELEGRAM_CHAT_ID: CHAT }).ativo, false, 'Só o chat: desligado');
    assert.equal(aviso.configuracao({ TELEGRAM_BOT_TOKEN: 'invalido', TELEGRAM_CHAT_ID: CHAT }).ativo, false, 'Token inválido: desligado');
    assert.equal(aviso.configuracao({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: 'abc' }).ativo, false, 'Chat inválido: desligado');
    assert.equal(aviso.configuracao({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT }).ativo, true, 'Completo: ligado');
    for (const env of [{}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: 'abc' }])
      assert.ok(!aviso.configuracao(env).motivo.includes(TOKEN), 'Mensagem de configuração sem valores');
    const texto = aviso.montarMensagem({ id: 'abcdef12-0000-4000-8000-000000000000', empresa: 'Empresa\nFictícia', nome: 'Pessoa', usuario: 'pessoa.x',
      criadoEm: '2026-11-08T17:32:00.000Z', assunto: 'x'.repeat(300), painel: '/admin#chamados' });
    assert.match(texto, /#ABCDEF12/); assert.match(texto, /Quando: 08\/11\/2026 14:32 \(horário de Brasília\)/, 'Fuso de São Paulo');
    assert.match(texto, /Empresa: Empresa Fictícia\n/, 'Quebra de linha removida dos campos');
    assert.ok(!texto.includes('x'.repeat(101)), 'Assunto limitado a 100 caracteres');

    // ------------------------------------------------ servidor com Telegram (falso) ligado
    const registro = path.join(base, 'telegram.jsonl');
    const S = await subir('principal', { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TESTE_TELEGRAM_REGISTRO: registro, ATENDE_LIMITE_CHAMADOS_DIA: '8' });
    assert.match(S.saida(), /Aviso de chamados por Telegram: ligado\./);
    const [admin, ana, carla, bruno, cliente] = await Promise.all(['admin.teste', 'ana.a', 'carla.a', 'bruno.b', 'cliente.a'].map(S.entrar));
    const valido = { assunto: 'Erro ao abrir o painel', descricao: 'A tela fica em branco\r\nao entrar no painel desde ontem.' };

    // Acesso
    assert.equal((await fetch(S.origin + ROTA)).status, 401, 'Sem login não lista');
    for (const [rota, metodo, corpo] of [[ROTA, 'GET'], [ROTA, 'POST', valido], [ADMIN, 'GET'], [ADMIN + '/' + crypto.randomUUID(), 'PUT', { confirmed: true, status: 'resolvido', resposta: '' }]])
      assert.equal((await cliente(rota, metodo, corpo)).status, 403, `Cliente barrado em ${metodo} ${rota}`);
    assert.equal((await ana(ADMIN)).status, 403, 'Atendimento não lista todos');
    assert.equal((await admin(ROTA, 'POST', valido)).status, 403, 'Admin não abre chamado');
    assert.equal((await ana(ROTA, 'POST', valido, false)).status, 403, 'Sem CSRF não abre');
    assert.equal((await fetch(S.origin + '/chamados.js', { redirect: 'manual' })).status, 302, 'Script não é público');
    assert.equal((await cliente('/chamados.js')).status, 302, 'Cliente não recebe o script');
    assert.equal((await ana('/chamados.js')).status, 200, 'Atendimento recebe o script');

    // Validação (nada é gravado e não conta no limite)
    const recusa = async (corpo, msg) => assert.equal((await ana(ROTA, 'POST', corpo)).status, 400, msg);
    await recusa({ ...valido, assunto: 'abcd' }, 'Assunto com 4');
    await recusa({ ...valido, assunto: 'a'.repeat(101) }, 'Assunto com 101');
    await recusa({ ...valido, descricao: 'b'.repeat(9) }, 'Descrição com 9');
    await recusa({ ...valido, descricao: 'b'.repeat(2001) }, 'Descrição com 2001');
    await recusa({ ...valido, assunto: 12345 }, 'Assunto que não é texto');
    await recusa({ descricao: valido.descricao }, 'Sem assunto');
    await recusa({ ...valido, assunto: '  \u0001\u0002   ' }, 'Assunto só com espaços e controles');
    assert.deepEqual((await (await ana(ROTA)).json()).items, [], 'Entrada recusada não grava');

    // Abertura
    let r = await ana(ROTA, 'POST', { ...valido, companyId: B });
    assert.equal(r.status, 201);
    const c1 = (await r.json()).item;
    assert.equal(c1.status, 'aberto'); assert.equal(c1.numero, c1.id.slice(0, 8).toUpperCase());
    assert.equal(c1.descricao, 'A tela fica em branco\nao entrar no painel desde ontem.', 'Quebra de linha normalizada');

    // Aviso pelo Telegram
    let enviados = await linhas(registro, 1);
    assert.equal(enviados.length, 1, 'Um aviso enviado');
    const msg = JSON.parse(enviados[0].corpo);
    assert.equal(enviados[0].caminho, `/bot${TOKEN}/sendMessage`); assert.equal(enviados[0].metodo, 'POST');
    assert.equal(msg.chat_id, CHAT); assert.equal(msg.parse_mode, undefined, 'Sem parse_mode');
    for (const parte of ['Clínica Fictícia A', 'Ana Fictícia (ana.a)', valido.assunto, '#' + c1.numero, brasilia(c1.criadoEm) + ' (horário de Brasília)', '/admin#chamados'])
      assert.ok(msg.text.includes(parte), 'Aviso contém: ' + parte);
    assert.ok(!msg.text.includes('tela fica em branco'), 'Aviso NÃO contém a descrição');

    // Isolamento: companyId da requisição ignorado; B não vê A; a empresa toda vê os chamados
    assert.deepEqual((await (await bruno(ROTA)).json()).items, [], 'B não vê o chamado da A');
    assert.equal((await carla(ROTA, 'POST', { assunto: 'Dúvida sobre relatório', descricao: 'Onde encontro o relatório mensal?' })).status, 201);
    const daA = (await (await ana(ROTA)).json()).items;
    assert.equal(daA.length, 2, 'Atendimento vê os chamados da empresa toda');
    assert.deepEqual(daA.map(x => x.abertoPor.nome).sort(), ['Ana Fictícia', 'Carla Fictícia']);
    assert.equal((await bruno(ROTA, 'POST', { assunto: 'Chamado da empresa B', descricao: 'Problema fictício da empresa B.' })).status, 201);
    assert.equal((await (await bruno(ROTA)).json()).items.length, 1, 'B vê só o próprio');

    // Admin: lista todos, filtra, responde
    let todos = (await (await admin(ADMIN)).json()).items;
    assert.equal(todos.length, 3, 'Admin vê todos');
    const doc1 = todos.find(x => x.id === c1.id);
    assert.deepEqual(doc1.empresa, { id: A, nome: 'Clínica Fictícia A' }); assert.deepEqual(doc1.abertoPor, { nome: 'Ana Fictícia', usuario: 'ana.a' });
    assert.equal(doc1.descricao, c1.descricao, 'Admin vê a descrição');
    assert.equal((await admin(ADMIN + '?status=invalido')).status, 400);
    const PUT = (quem, id, corpo) => quem(ADMIN + '/' + id, 'PUT', corpo);
    assert.equal((await PUT(admin, c1.id, { status: 'resolvido', resposta: 'Ok' })).status, 400, 'Sem confirmação não salva');
    assert.equal((await PUT(admin, c1.id, { confirmed: true, status: 'fechado', resposta: '' })).status, 400, 'Status inválido');
    assert.equal((await PUT(admin, c1.id, { confirmed: true, status: 'resolvido', resposta: 'r'.repeat(2001) })).status, 400, 'Resposta longa demais');
    assert.equal((await PUT(admin, crypto.randomUUID(), { confirmed: true, status: 'resolvido', resposta: '' })).status, 404, 'Chamado inexistente');
    assert.equal((await PUT(ana, c1.id, { confirmed: true, status: 'resolvido', resposta: 'Eu mesma resolvi' })).status, 403, 'Atendimento não muda status');
    assert.equal((await PUT(admin, c1.id, { confirmed: true, status: 'em_andamento', resposta: 'Estamos verificando o problema.' })).status, 200);
    const visto = (await (await ana(ROTA)).json()).items.find(x => x.id === c1.id);
    assert.equal(visto.status, 'em_andamento'); assert.equal(visto.resposta, 'Estamos verificando o problema.', 'Atendimento vê a resposta');
    assert.deepEqual((await (await admin(ADMIN + '?status=em_andamento')).json()).items.map(x => x.id), [c1.id], 'Filtro por status');

    // Limites: 5 por usuário por hora (ana já abriu 1) e teto global de 8 por dia (já há 3)
    for (let i = 2; i <= 5; i++) assert.equal((await ana(ROTA, 'POST', { ...valido, assunto: 'Chamado número ' + i })).status, 201, 'Chamado ' + i + ' da ana');
    r = await ana(ROTA, 'POST', valido);
    assert.equal(r.status, 429, '6º chamado da ana na hora é recusado'); assert.ok(r.headers.get('retry-after'));
    assert.equal((await carla(ROTA, 'POST', { ...valido, assunto: 'Outro usuário segue' })).status, 201, 'Outro usuário continua abrindo'); // 8º no dia
    assert.equal((await bruno(ROTA, 'POST', valido)).status, 429, 'Teto global do dia');
    assert.equal((await (await admin(ADMIN)).json()).items.length, 8);

    // Auditoria sem conteúdo
    const { items: auditoria } = await (await admin('/api/admin/audit')).json();
    assert.ok(auditoria.some(x => x.action === 'chamado_aberto' && x.actor === 'ana.a' && x.detail === '#' + c1.numero));
    assert.ok(auditoria.some(x => x.action === 'chamado_atualizado' && x.actor === 'admin.teste' && x.detail === `#${c1.numero}: em_andamento`));
    const textoAuditoria = JSON.stringify(auditoria.filter(x => x.action.startsWith('chamado_')));
    for (const proibido of ['Erro ao abrir', 'tela fica', 'verificando']) assert.ok(!textoAuditoria.includes(proibido), 'Auditoria sem conteúdo: ' + proibido);
    enviados = await linhas(registro, 8);
    assert.equal(enviados.length, 8, 'Um aviso por chamado aberto');
    assert.ok(!S.saida().includes(TOKEN), 'Token fora do log');

    // ------------------------------------------------ Telegram fora do ar
    const registroFalha = path.join(base, 'telegram-falha.jsonl');
    const F = await subir('falha', { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TESTE_TELEGRAM_REGISTRO: registroFalha, TESTE_TELEGRAM_FALHA: '1' });
    const anaF = await F.entrar('ana.a');
    assert.equal((await anaF(ROTA, 'POST', valido)).status, 201, 'Falha do Telegram não impede o chamado');
    assert.equal((await linhas(registroFalha, 1)).length, 1, 'O envio foi tentado');
    for (let t = 0; t < 40 && !F.saida().includes('Aviso do chamado indisponível'); t++) await wait(50);
    assert.ok(F.saida().includes('Aviso do chamado indisponível'), 'Log registra a falha');
    for (const proibido of [TOKEN, CHAT, valido.assunto, 'Ana Fictícia', 'ana.a', 'ECONNRESET']) assert.ok(!F.saida().includes(proibido), 'Log da falha sem: ' + proibido);
    assert.equal((await (await anaF(ROTA)).json()).items.length, 1, 'Chamado gravado mesmo sem aviso');

    // ------------------------------------------------ sem Telegram, pela metade e com formato inválido: sobe, aviso desligado
    for (const [nome, env, esperado] of [
      ['sem', {}, /Telegram: desligado/],
      ['metade', { TELEGRAM_BOT_TOKEN: TOKEN }, /Telegram: DESLIGADO, configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID juntos\./],
      ['invalido', { TELEGRAM_BOT_TOKEN: 'token-errado', TELEGRAM_CHAT_ID: CHAT }, /Telegram: DESLIGADO, formato inválido/],
    ]) {
      const reg = path.join(base, `telegram-${nome}.jsonl`);
      const X = await subir(nome, { ...env, TESTE_TELEGRAM_REGISTRO: reg });
      assert.match(X.saida(), esperado, `Partida (${nome}) explica o estado do aviso`);
      assert.ok(!X.saida().includes(TOKEN) && !X.saida().includes('token-errado'), `Partida (${nome}) sem valores`);
      const anaX = await X.entrar('ana.a');
      assert.equal((await anaX(ROTA, 'POST', valido)).status, 201, `Chamado aberto (${nome})`);
      await wait(300);
      assert.equal((await linhas(reg, 1, 300)).length, 0, `Nada enviado (${nome})`);
    }

    // ------------------------------------------------ páginas
    const pagina = nome => fs.readFile(path.join(root, 'site', 'interno', nome), 'utf8');
    assert.match(await pagina('atendimento.html'), /id="chamado-form"/);
    assert.match(await pagina('admin.html'), /id="chamados-admin-box"/);
    assert.doesNotMatch(await pagina('cliente.html'), /chamado/, 'Área do cliente sem chamados');
    assert.doesNotMatch(await pagina('chamados.js'), /innerHTML/, 'DOM montado sem innerHTML');

    console.log('OK: chamados — perfis, isolamento entre empresas, validação, limites, aviso do Telegram sem descrição, falha e configuração incompleta sem impedir o chamado, auditoria sem conteúdo.');
  } finally {
    for (const p of servidores) p.kill();
    await wait(300); await fs.rm(base, { recursive: true, force: true }).catch(() => {});
  }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
