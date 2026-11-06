'use strict';
// Dados da empresa: cada empresa só alcança os próprios; atendimento não escolhe empresa;
// cliente não acessa; entrada validada; auditoria sem conteúdo.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROTA = '/api/staff/dados-empresa';

(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-dados-empresa-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  const { hashPassword } = require(path.join(base, 'auth.js'));
  const senha = 'Senha-Ficticia-2026!', A = crypto.randomUUID(), B = crypto.randomUUID();
  const emp = (id, name) => ({ id, name, city: 'Cidade Fictícia', uf: 'SC', timeZone: 'America/Sao_Paulo', contact: '', notes: '', state: 'ativa',
    subscription: { plan: 'essencial', status: 'teste', setupCents: 0, monthlyCents: 0, nextDueDate: null, paymentIntegration: false }, createdAt: new Date().toISOString() });
  const u = (username, role, companyId) => ({ id: crypto.randomUUID(), username, name: username, role, companyId, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword(senha) });
  await fs.writeFile(path.join(data, 'empresas.json'), JSON.stringify([emp(A, 'Clínica Fictícia A'), emp(B, 'Clínica Fictícia B')]));
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([u('admin.teste', 'admin', null), u('ana.a', 'atendimento', A), u('bruno.b', 'atendimento', B), u('cliente.a', 'cliente', A)]));
  const port = 38000 + Math.floor(Math.random() * 900), origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  try {
    let ok = false; for (let i = 0; i < 80 && !ok; i++) { await wait(100); try { ok = (await fetch(origin + '/api/auth/me')).ok; } catch {} }
    assert.ok(ok, 'Servidor iniciou');
    async function entrar(username) {
      const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: senha }) });
      assert.equal(r.status, 200, username); const { csrf } = await r.json();
      const cookie = r.headers.get('set-cookie').split(';')[0];
      const chamar = (rota, metodo = 'GET', corpo, comCsrf = true) => fetch(origin + rota, { method: metodo, redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...(comCsrf ? { 'X-CSRF-Token': csrf } : {}) }, body: corpo && JSON.stringify(corpo) });
      return chamar;
    }
    const dados = { confirmed: true, horario: 'Segunda a sexta,\r\ndas 8h às 18h', endereco: 'Rua Fictícia,\n100', servicos: [{ nome: 'Consulta', preco: 'R$ 80,00' }, { nome: '', preco: '' }, { nome: 'Retorno', preco: '' }], perguntas: [{ pergunta: 'Aceita convênio?', resposta: 'Sim, os principais.' }, { pergunta: ' ', resposta: '' }] };
    const [admin, ana, bruno, cliente] = await Promise.all(['admin.teste', 'ana.a', 'bruno.b', 'cliente.a'].map(entrar));

    // Acesso
    assert.equal((await fetch(origin + ROTA)).status, 401, 'Sem login não lê');
    assert.equal((await cliente(ROTA)).status, 403, 'Cliente não lê');
    assert.equal((await cliente(ROTA, 'PUT', dados)).status, 403, 'Cliente não grava');
    assert.equal((await ana(ROTA, 'PUT', dados, false)).status, 403, 'Sem CSRF não grava');
    assert.equal((await ana(ROTA, 'PUT', { ...dados, confirmed: undefined })).status, 400, 'Sem confirmação não grava');
    assert.equal((await fetch(origin + '/dados-empresa.js', { redirect: 'manual' })).status, 302, 'Script não é público');
    assert.equal((await cliente('/dados-empresa.js')).status, 302, 'Cliente não recebe o script');
    assert.equal((await ana('/dados-empresa.js')).status, 200, 'Atendimento recebe o script');
    assert.equal((await admin('/dados-empresa.js')).status, 200, 'Admin recebe o script');

    // Começa vazio
    let r = await (await ana(ROTA)).json();
    assert.equal(r.companyId, A); assert.deepEqual(r.dados.servicos, []); assert.equal(r.dados.horario, '');

    // Gravação e limpeza
    let resp = await ana(ROTA, 'PUT', dados);
    assert.equal(resp.status, 200);
    r = await (await ana(ROTA)).json();
    assert.equal(r.dados.horario, 'Segunda a sexta,\ndas 8h às 18h', 'Quebra de linha normalizada no horário');
    assert.equal(r.dados.endereco, 'Rua Fictícia, 100', 'Endereço fica em uma linha');
    assert.deepEqual(r.dados.servicos, [{ nome: 'Consulta', preco: 'R$ 80,00' }, { nome: 'Retorno', preco: '' }], 'Linhas em branco são descartadas');
    assert.deepEqual(r.dados.perguntas, [{ pergunta: 'Aceita convênio?', resposta: 'Sim, os principais.' }]);
    assert.ok(r.dados.atualizadaEm, 'Data de alteração registrada');

    // Isolamento entre empresas
    r = await (await bruno(ROTA + '?empresa=' + A)).json();
    assert.equal(r.companyId, B, 'Atendimento não escolhe empresa pela consulta');
    assert.equal(r.dados.horario, '', 'B não vê os dados da A');
    resp = await bruno(ROTA, 'PUT', { ...dados, horario: 'Gravado pela B', companyId: A });
    assert.equal(resp.status, 200);
    assert.equal((await resp.json()).companyId, B, 'companyId da requisição é ignorado para o atendimento');
    assert.equal((await (await ana(ROTA)).json()).dados.horario, 'Segunda a sexta,\ndas 8h às 18h', 'A continua intacta depois da gravação da B');
    assert.equal((await (await bruno(ROTA)).json()).dados.horario, 'Gravado pela B');

    // Administrador escolhe a empresa
    assert.equal((await admin(ROTA)).status, 400, 'Admin precisa escolher a empresa');
    assert.equal((await admin(ROTA + '?empresa=' + crypto.randomUUID())).status, 404);
    assert.equal((await admin(ROTA + '?empresa=nao-e-id')).status, 404);
    assert.equal((await admin(ROTA, 'PUT', { ...dados, companyId: crypto.randomUUID() })).status, 404, 'Empresa inexistente é recusada');
    assert.equal((await (await admin(ROTA + '?empresa=' + A)).json()).dados.endereco, 'Rua Fictícia, 100');
    assert.equal((await admin(ROTA, 'PUT', { ...dados, endereco: 'Rua do Admin', companyId: A })).status, 200);
    assert.equal((await (await ana(ROTA)).json()).dados.endereco, 'Rua do Admin');

    // Validação
    const recusa = async (corpo, msg) => assert.equal((await ana(ROTA, 'PUT', { confirmed: true, ...corpo })).status, 400, msg);
    await recusa({ horario: 'x'.repeat(301) }, 'Horário longo demais');
    await recusa({ endereco: 123 }, 'Endereço que não é texto');
    await recusa({ servicos: 'Consulta' }, 'Serviços que não são lista');
    await recusa({ servicos: ['Consulta'] }, 'Serviço que não é objeto');
    await recusa({ servicos: [{ nome: '', preco: 'R$ 10' }] }, 'Preço sem serviço');
    await recusa({ servicos: [{ nome: 'x'.repeat(91) }] }, 'Nome de serviço longo demais');
    await recusa({ servicos: Array.from({ length: 31 }, (_, i) => ({ nome: 'S' + i })) }, 'Serviços demais');
    await recusa({ perguntas: [{ pergunta: 'Só a pergunta?', resposta: '' }] }, 'Pergunta sem resposta');
    await recusa({ perguntas: Array.from({ length: 16 }, (_, i) => ({ pergunta: 'P' + i, resposta: 'R' })) }, 'Perguntas demais');
    assert.equal((await (await ana(ROTA)).json()).dados.endereco, 'Rua do Admin', 'Entrada recusada não altera nada');

    // Formulário cheio cabe no teto de 16 KB por requisição.
    const cheio = { confirmed: true, horario: 'h'.repeat(300), endereco: 'e'.repeat(300),
      servicos: Array.from({ length: 30 }, () => ({ nome: 'n'.repeat(90), preco: 'p'.repeat(60) })),
      perguntas: Array.from({ length: 15 }, () => ({ pergunta: 'q'.repeat(150), resposta: 'r'.repeat(400) })) };
    assert.ok(JSON.stringify(cheio).length < 16_000, 'Limites cabem no teto');
    assert.equal((await ana(ROTA, 'PUT', cheio)).status, 200, 'Formulário cheio é aceito');
    assert.equal((await (await ana(ROTA)).json()).dados.perguntas.length, 15);

    // Auditoria registra a ação, nunca o conteúdo.
    const { items } = await (await admin('/api/admin/audit')).json();
    const registros = items.filter(x => x.action === 'dados_empresa_alterados');
    assert.ok(registros.some(x => x.actor === 'ana.a' && x.detail === 'Empresa ' + A), 'Ação auditada');
    assert.ok(!JSON.stringify(registros).includes('Consulta'), 'Conteúdo fora da auditoria');

    // Páginas: formulário só onde deve estar e sem innerHTML.
    const pagina = nome => fs.readFile(path.join(root, 'site', 'interno', nome), 'utf8');
    for (const nome of ['admin.html', 'atendimento.html']) assert.match(await pagina(nome), /id="dados-empresa-form"/, nome);
    assert.doesNotMatch(await pagina('cliente.html'), /dados-empresa/, 'Área do cliente sem o formulário');
    assert.doesNotMatch(await pagina('dados-empresa.js'), /innerHTML/, 'DOM montado sem innerHTML');

    console.log('OK: dados da empresa — isolamento entre empresas, perfis, CSRF, validação, teto de 16 KB e auditoria sem conteúdo.');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
