'use strict';
// Garantias do motor PostgreSQL. Só roda com TESTE_PG_DONO e TESTE_PG_APP_SENHA (veja dados/LEIA-ME.md).
//  1. Isolamento no próprio banco (RLS): com o contexto da empresa A, a empresa B não aparece
//     nem pode ser alterada, mesmo numa consulta sem filtro.
//  2. Sessão sobrevive ao reinício do servidor.
//  3. Reenvio da Meta após reinício não duplica a mensagem.
//  4. Importação dos JSON pode ser repetida sem duplicar.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const dono = process.env.TESTE_PG_DONO, senhaApp = process.env.TESTE_PG_APP_SENHA;
if (!dono || !senhaApp) { console.log('PULADO: defina TESTE_PG_DONO e TESTE_PG_APP_SENHA para testar o PostgreSQL.'); process.exit(0); }
const { Client } = require(path.join(root, 'node_modules', 'pg'));

(async () => {
  const nome = 'atende_t_garantias_' + process.pid;
  const raiz = new Client({ connectionString: dono }); await raiz.connect();
  await raiz.query(`CREATE DATABASE ${nome}`); await raiz.end();
  const urlDono = new URL(dono); urlDono.pathname = '/' + nome;
  const urlApp = new URL(urlDono); urlApp.username = 'atende_app'; urlApp.password = senhaApp;
  try {
    await require(path.join(root, 'dados', 'migrar.js')).migrar({ url: urlDono.toString(), senhaApp, log: () => {} });
    const novo = () => { delete require.cache[require.resolve(path.join(root, 'dados', 'postgres.js'))]; return require(path.join(root, 'dados', 'postgres.js')).criar({ DATABASE_URL: urlApp.toString() }); };
    let D = novo(); await D.iniciar();
    const A = crypto.randomUUID(), B = crypto.randomUUID();
    const emp = (id, name) => ({ id, name, city: 'Cidade Fictícia', uf: 'SC', timeZone: 'America/Sao_Paulo', contact: '', notes: '', state: 'ativa',
      subscription: { plan: 'essencial', status: 'teste', setupCents: 0, monthlyCents: 0, nextDueDate: null, paymentIntegration: false }, createdAt: new Date().toISOString() });
    await D.empresas.atualizarLista(l => { l.push(emp(A, 'Empresa Fictícia A'), emp(B, 'Empresa Fictícia B')); });
    const usu = (username, role, companyId) => ({ id: crypto.randomUUID(), username, name: username, role, companyId, active: true, mustChangePassword: false, hash: 'aa', salt: 'bb', createdAt: new Date().toISOString() });
    const clienteA = usu('cliente.a', 'cliente', A), clienteB = usu('cliente.b', 'cliente', B);
    await D.usuarios.atualizarLista(l => { l.push(clienteA, clienteB); });
    const agora = new Date().toISOString();
    const sol = (empresa, dono_) => ({ id: crypto.randomUUID(), companyId: empresa, ownerId: dono_.id, customerName: dono_.name, subject: 'Assunto fictício', description: 'Descrição fictícia longa',
      status: 'novo', priority: 'normal', assignedTo: null, createdAt: agora, updatedAt: agora, messages: [{ id: crypto.randomUUID(), author: dono_.name, role: 'cliente', content: 'Olá', internal: false, createdAt: agora }] });
    const sA = sol(A, clienteA), sB = sol(B, clienteB);
    await D.solicitacoes.criar(sA); await D.solicitacoes.criar(sB);

    // 1. RLS: consultas SEM filtro de empresa, direto no banco, com o contexto da empresa A.
    const app = new Client({ connectionString: urlApp.toString() }); await app.connect();
    await app.query('BEGIN'); await app.query("SELECT set_config('app.empresa_id', $1, true)", [A]);
    const visiveis = (await app.query('SELECT id FROM solicitacoes')).rows.map(r => r.id);
    assert.deepEqual(visiveis, [sA.id], 'Com o contexto da empresa A, só a solicitação da A aparece');
    assert.equal((await app.query("UPDATE solicitacoes SET situacao = 'resolvido' WHERE id = $1", [sB.id])).rowCount, 0, 'A não altera a B');
    await assert.rejects(app.query(`INSERT INTO solicitacoes (id, empresa_id, cliente_id, nome_cliente, assunto, descricao) VALUES ($1,$2,$3,'x','Assunto x','Descrição x longa')`,
      [crypto.randomUUID(), B, clienteB.id]), /row-level security/, 'A não grava na B');
    await app.query('ROLLBACK');
    await app.query('BEGIN');
    assert.equal((await app.query('SELECT count(*)::int AS n FROM solicitacoes')).rows[0].n, 0, 'Sem contexto nenhum, nada aparece');
    await app.query('ROLLBACK');
    await assert.rejects(app.query('DELETE FROM auditoria'), /permission denied/, 'A aplicação não apaga a auditoria');
    await app.end();
    // Pela camada de dados, com escopo da empresa A:
    assert.equal(await D.solicitacoes.obter({ perfil: 'atendimento', empresaId: A }, sB.id), null, 'Camada de dados: A não lê a B');
    assert.equal((await D.solicitacoes.listar({ perfil: 'atendimento', empresaId: A })).length, 1);

    // 2 e 3. Sessão e reenvio da Meta sobrevivem ao reinício.
    await D.sessoes.criar('a'.repeat(64), { id: clienteA.id, csrf: 'c'.repeat(32), created: Date.now(), seen: Date.now() });
    const r1 = await D.conversas.registrarEntrada({ telefone: '5500000000001', nome: 'Contato Fictício', texto: 'oi', idMeta: 'wamid.FICTICIO1' }, A);
    assert.equal(r1.duplicada, false);
    await D.encerrar(); D = novo(); await D.iniciar(); // "reinício"
    assert.equal((await D.sessoes.obter('a'.repeat(64)))?.id, clienteA.id, 'Sessão continua válida depois do reinício');
    const r2 = await D.conversas.registrarEntrada({ telefone: '5500000000001', nome: 'Contato Fictício', texto: 'oi', idMeta: 'wamid.FICTICIO1' }, A);
    assert.equal(r2.duplicada, true, 'Reenvio da Meta depois do reinício é reconhecido');
    const [conv] = await D.conversas.listar({ perfil: 'atendimento', empresaId: A });
    assert.equal((await D.conversas.obter(null, conv.id)).mensagens.length, 1, 'A mensagem não foi duplicada');
    assert.equal((await D.conversas.listar({ perfil: 'atendimento', empresaId: B })).length, 0, 'Conversa da A não aparece para a B');
    // Mesmo telefone em outra empresa = outra conversa.
    await D.conversas.registrarEntrada({ telefone: '5500000000001', nome: 'Contato Fictício', texto: 'oi B', idMeta: 'wamid.FICTICIO2' }, B);
    assert.equal((await D.conversas.listar(null)).length, 2, 'Mesmo telefone em duas empresas gera duas conversas');

    // Alteração de solicitação grava só o que mudou e acrescenta mensagens.
    await D.solicitacoes.alterar({ perfil: 'atendimento', empresaId: A }, sA.id, x => { x.status = 'em_andamento'; x.messages.push({ id: crypto.randomUUID(), author: 'Equipe', role: 'atendimento', content: 'Nota', internal: true, createdAt: new Date().toISOString() }); });
    const depois = await D.solicitacoes.obter(null, sA.id);
    assert.equal(depois.status, 'em_andamento'); assert.equal(depois.messages.length, 2); assert.equal(depois.messages[1].internal, true);
    // Histórico de assinatura: mudar o plano encerra a vigente e cria outra.
    await D.empresas.atualizarLista(l => { l.find(e => e.id === A).subscription = { plan: 'profissional', status: 'ativa', setupCents: 89000, monthlyCents: 39900, nextDueDate: '2026-12-10', paymentIntegration: false }; });
    assert.equal((await D.empresas.obter(A)).subscription.plan, 'profissional');
    assert.equal((await D.empresas.obter(A)).subscription.nextDueDate, '2026-12-10');
    await D.encerrar();

    // 4. Importação repetida não duplica.
    const fs = require('node:fs/promises'), os = require('node:os');
    const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-import-'));
    const E = crypto.randomUUID(), cli = usu('cliente.import', 'cliente', E);
    await fs.writeFile(path.join(pasta, 'empresas.json'), JSON.stringify([emp(E, 'Empresa Importada')]));
    await fs.writeFile(path.join(pasta, 'usuarios.json'), JSON.stringify([cli, usu('sem.empresa', 'cliente', null)]));
    await fs.writeFile(path.join(pasta, 'solicitacoes.json'), JSON.stringify([sol(E, cli)]));
    const { importar } = require(path.join(root, 'dados', 'importar-json.js'));
    const um = await importar({ pasta, url: urlDono.toString(), log: () => {} });
    const dois = await importar({ pasta, url: urlDono.toString(), log: () => {} });
    assert.equal(um.usuarios.importados, 2); assert.equal(dois.usuarios.importados, 0); assert.equal(dois.usuarios.jaExistiam, 2);
    assert.equal(um.solicitacoes.importados, 1); assert.equal(dois.solicitacoes.jaExistiam, 1);
    const verif = new Client({ connectionString: urlDono.toString() }); await verif.connect();
    assert.equal((await verif.query("SELECT empresa_id FROM usuarios WHERE usuario = 'sem.empresa'")).rows[0].empresa_id, '00000000-0000-4000-8000-000000000001', 'Usuário sem empresa vai para Ambiente de testes anterior');
    await verif.end();
    await fs.rm(pasta, { recursive: true, force: true });
    console.log('OK: PostgreSQL — isolamento no banco (RLS), sessão e reenvio da Meta após reinício, conversa por empresa, histórico de assinatura e importação repetível.');
  } finally {
    const limpa = new Client({ connectionString: dono }); await limpa.connect();
    await limpa.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`); await limpa.end();
  }
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
