'use strict';
// Página pública /calculadora: cálculo, rotas sem login, sitemap e garantia de que nada do que
// o visitante digita sai do navegador.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs =require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

function testarCalculo() {
  const { lerNumero, validarCampo, calcularPerda } = require(path.join(root, 'site', 'publico', 'calculadora.js'));

  // Formato brasileiro.
  assert.equal(lerNumero('1500'), 1500);
  assert.equal(lerNumero('1.500'), 1500, 'Ponto com três dígitos é milhar');
  assert.equal(lerNumero('1.500,50'), 1500.5);
  assert.equal(lerNumero('1.234.567'), 1234567);
  assert.equal(lerNumero('12,5'), 12.5);
  assert.equal(lerNumero('12.5'), 12.5, 'Ponto como decimal também é aceito');
  assert.equal(lerNumero('R$ 250,00'), 250);
  assert.equal(lerNumero(' 30 % '), 30);
  assert.equal(lerNumero('0'), 0);

  // Vazio não é erro; texto inválido é.
  assert.equal(lerNumero(''), null);
  assert.equal(lerNumero('   '), null);
  for (const invalido of ['abc', '-5', '1e5', '1,2,3', '1.50.0', 'NaN', 'Infinity', '<b>1</b>']) {
    assert.ok(Number.isNaN(lerNumero(invalido)), `"${invalido}" deve ser recusado`);
  }

  // Limites por campo.
  assert.deepEqual(validarCampo('contatos', ''), { valor: null, erro: '' });
  assert.equal(validarCampo('contatos', '100').valor, 100);
  assert.ok(validarCampo('contatos', '10,5').erro, 'Contatos precisam ser inteiros');
  assert.ok(validarCampo('contatos', '100.000.001').erro, 'Contatos têm limite');
  assert.equal(validarCampo('semResposta', '100').valor, 100);
  assert.ok(validarCampo('semResposta', '100,5').erro, 'Percentual não passa de 100');
  assert.ok(validarCampo('conversao', '101').erro, 'Percentual não passa de 100');
  assert.ok(validarCampo('conversao', '-1').erro, 'Percentual não é negativo');
  assert.ok(validarCampo('valorVenda', 'abc').erro);
  assert.ok(validarCampo('valorVenda', '1.000.000.001').erro, 'Valor tem limite');

  // 1000 contatos, 20% perdidos = 200; 10% virariam venda = 20; a R$ 150 = R$ 3.000; ×12 = R$ 36.000.
  assert.deepEqual(calcularPerda({ contatos: 1000, semResposta: 20, conversao: 10, valorVenda: 150 }),
    { contatosPerdidos: 200, vendasPerdidas: 20, perdaMes: 3000, perdaAno: 36000 });
  assert.equal(calcularPerda({ contatos: 1000, semResposta: 0, conversao: 10, valorVenda: 150 }).perdaAno, 0);
  assert.equal(calcularPerda({ contatos: 0, semResposta: 20, conversao: 10, valorVenda: 150 }).perdaMes, 0);
  assert.equal(calcularPerda({ contatos: 1000, semResposta: 20, conversao: 0, valorVenda: 150 }).vendasPerdidas, 0);
  // Os limites dos campos não podem gerar um número que o navegador não sabe escrever.
  assert.ok(Number.isFinite(calcularPerda({ contatos: 100_000_000, semResposta: 100, conversao: 100, valorVenda: 1_000_000_000 }).perdaAno));
}

async function testarPagina() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'atende-calculadora-')), data = path.join(base, 'data');
  await require('./arquivos-servidor').copiar(root, base);
  await fs.cp(path.join(root, 'site'), path.join(base, 'site'), { recursive: true });
  await fs.mkdir(data);
  // O servidor não sobe sem usuários. A página é testada sem login: este admin nunca entra.
  const { hashPassword } = require(path.join(base, 'auth.js'));
  await fs.writeFile(path.join(data, 'usuarios.json'), JSON.stringify([{ id: crypto.randomUUID(), username: 'admin.teste', name: 'Admin', role: 'admin', companyId: null, active: true, mustChangePassword: false, createdAt: new Date().toISOString(), ...hashPassword('Senha-Ficticia-2026!') }]));
  const port = 40000 + Math.floor(Math.random() * 900);
  const dominio = 'atende.exemplo.com.br', origem = 'https://' + dominio;
  const env = { ...process.env, ATENDE_DATA_DIR: data, PORT: String(port), GEMINI_API_KEY: '', TAILSCALE_HOST: '', SITE_ORIGIN: origem, ATENDE_PROXY_CONFIAVEL: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('WHATSAPP_')) delete env[k];
  const server = spawn(process.execPath, ['server.js'], { cwd: base, stdio: 'ignore', env });
  // http.request em vez de fetch: o fetch não deixa trocar o cabeçalho Host (como faz o Caddy).
  const pedir = rota => new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port, path: rota, headers: { Host: dominio, 'X-Forwarded-For': '203.0.113.10' } }, res => {
      let corpo = ''; res.on('data', c => corpo += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo }));
    });
    req.on('error', falha); req.end();
  });
  try {
    let pronto = false;
    for (let i = 0; i < 80 && !pronto; i++) { await wait(100); try { pronto = (await pedir('/api/status')).status === 200; } catch {} }
    assert.ok(pronto, 'Servidor não iniciou');

    const pagina = await pedir('/calculadora');
    assert.equal(pagina.status, 200, 'Página abre sem login');
    assert.match(pagina.headers['content-type'], /text\/html/);
    assert.match(pagina.headers['content-security-policy'], /script-src 'self'/, 'Página mantém a política de segurança');
    assert.ok(pagina.corpo.includes(`<link rel="canonical" href="${origem}/calculadora">`), 'Endereço canônico da página');
    assert.equal(pagina.headers['x-robots-tag'], undefined, 'Produção permite indexar a página');
    assert.equal((await pedir('/calculadora.html')).status, 404, 'Só a rota explícita é publicada');

    const sitemap = await pedir('/sitemap.xml');
    assert.ok(sitemap.corpo.includes(`<loc>${origem}/calculadora</loc>`), 'Página está no sitemap');

    // Arquivos citados pela página existem, e a política de segurança não bloqueia nada dela.
    const citados = [...pagina.corpo.matchAll(/(?:src|href)="(\/[\w.-]+\.\w+)/g)].map(m => m[1]);
    for (const arquivo of ['/calculadora.js', '/calculadora.css', '/style.css', '/tema.js']) assert.ok(citados.includes(arquivo), `${arquivo} citado na página`);
    for (const arquivo of citados) assert.equal((await pedir(arquivo)).status, 200, `${arquivo} sem rota`);
    assert.doesNotMatch(pagina.corpo, /<script(?![^>]*\bsrc=)/i, 'Sem script embutido além do que o servidor injeta');
    assert.doesNotMatch(pagina.corpo, /<style|\sstyle=|\son[a-z]+=/i, 'Sem estilo ou evento embutido');
    const inicial = (await pedir('/')).corpo;
    assert.match(inicial, /id="agente"/, 'O botão da página leva a um destino que existe');

    // Página inicial: cartão de chamada logo abaixo do chat do "Experimente agora", com link para /calculadora.
    const experimente = inicial.slice(inicial.indexOf('id="experimente"'));
    const cartao = experimente.match(/<aside class="cta-calculadora"[^>]*>([\s\S]*?)<\/aside>/);
    assert.ok(cartao, 'Cartão da calculadora na seção Experimente agora');
    assert.ok(experimente.indexOf('id="experimente-chat"') < experimente.indexOf('class="cta-calculadora"'), 'Cartão abaixo do chat');
    assert.ok(cartao[1].includes('Quanto o atendimento lento custa para a sua empresa?'));
    assert.ok(cartao[1].includes('Informe seus números e veja, em um minuto, quanto você deixa de ganhar por mês com mensagens sem resposta.'));
    assert.match(cartao[1], /<a class="btn btn-secondary" href="\/calculadora">Abrir a calculadora<\/a>/, 'Link acessível para /calculadora');
    assert.doesNotMatch(cartao[1], /\d+ ?%|R\$|garant/i, 'Sem estatística nem promessa');
    assert.doesNotMatch(inicial, /<style|\sstyle=|\son[a-z]+=/i, 'Página inicial sem estilo ou evento embutido');
    assert.match((await pedir('/style.css')).corpo, /\.cta-calculadora\s*\{/, 'Classe do cartão no CSS público');

    // Todo id citado por aria-describedby ou pelo script existe na página.
    const ids = new Set([...pagina.corpo.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    for (const m of pagina.corpo.matchAll(/aria-describedby="([^"]+)"/g)) for (const id of m[1].split(' ')) assert.ok(ids.has(id), `id ${id} não existe`);

    // Nada do que é digitado sai do navegador, e a tela não monta HTML com dados.
    const script = (await pedir('/calculadora.js')).corpo;
    assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|document\.cookie|innerHTML|insertAdjacentHTML|outerHTML/, 'Script não envia nem guarda dados');
    for (const nome of ['contatos', 'semResposta', 'conversao', 'valorVenda']) {
      assert.ok(ids.has(nome) && ids.has(`${nome}-erro`), `Campo ${nome} completo na página`);
      assert.doesNotMatch(pagina.corpo, new RegExp(`id="${nome}"[^>]*\\b(value|placeholder)=`), 'Campos começam vazios, sem sugerir números');
    }
    assert.doesNotMatch(pagina.corpo, /fict[ií]ci|prot[oó]tipo|simula[cç]|em desenvolvimento|ambiente de testes/i, 'Página não expõe textos internos');
  } finally { server.kill(); await wait(200); await fs.rm(base, { recursive: true, force: true }).catch(() => {}); }
}

(async () => {
  testarCalculo();
  await testarPagina();
  console.log('OK: calculadora — cálculo, formato brasileiro, rotas sem login, sitemap e nenhum envio de dados.');
})().catch(err => { console.error('FALHA NO TESTE:', err); process.exitCode = 1; });
