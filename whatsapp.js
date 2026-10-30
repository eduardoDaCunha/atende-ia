/** Atende.IA — webhook do WhatsApp Cloud API (Meta), em processo separado do painel.
 *  Escuta só em 127.0.0.1 e só na rota /webhook/whatsapp: o túnel HTTPS aponta para
 *  esta porta, nunca para a do painel. Toda mensagem recebida precisa da assinatura
 *  X-Hub-Signature-256 da Meta. Conversas ficam apenas na memória: este processo não
 *  grava nos arquivos JSON do servidor principal.
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { AI_ENABLED, MODEL, str, company, demoAnswer, aiAnswer } = require('./resposta');

const ROUTE = '/webhook/whatsapp';
const HOST = '127.0.0.1';
const MAX_BODY = 256_000;
const HISTORY_TTL = 24 * 60 * 60 * 1000;

function loadConfig(env=process.env) {
  const config = {
    port: Number(env.WHATSAPP_PORT || 3012),
    verifyToken: str(env.WHATSAPP_VERIFY_TOKEN, 200),
    appSecret: str(env.WHATSAPP_APP_SECRET, 200),
    token: str(env.WHATSAPP_TOKEN, 1000),
    phoneNumberId: str(env.WHATSAPP_PHONE_NUMBER_ID, 40),
    graphVersion: str(env.WHATSAPP_GRAPH_VERSION, 10) || 'v23.0',
    allowed: str(env.WHATSAPP_ALLOWED_NUMBERS, 500).split(',').map(x=>x.replace(/\D/g,'')).filter(Boolean),
  };
  const missing = ['verifyToken','appSecret','token','phoneNumberId'].filter(k=>!config[k]);
  if (missing.length) throw new Error('Configuração do WhatsApp incompleta. Preencha em config-local.bat: '+missing.map(k=>({verifyToken:'WHATSAPP_VERIFY_TOKEN',appSecret:'WHATSAPP_APP_SECRET',token:'WHATSAPP_TOKEN',phoneNumberId:'WHATSAPP_PHONE_NUMBER_ID'})[k]).join(', '));
  if (config.verifyToken.length < 16) throw new Error('WHATSAPP_VERIFY_TOKEN deve ter pelo menos 16 caracteres.');
  if (!/^\d{5,30}$/.test(config.phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID deve conter apenas números.');
  if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('WHATSAPP_GRAPH_VERSION inválida. Exemplo: v23.0');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('WHATSAPP_PORT inválida.');
  return config;
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function validSignature(raw, header, appSecret) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  return sameSecret(header, expected);
}
// No Brasil o WhatsApp às vezes entrega o número sem o nono dígito (55 DD 8 dígitos).
function brVariants(digits) {
  const set = new Set([digits]);
  if (/^55\d{2}9\d{8}$/.test(digits)) set.add(digits.slice(0,4) + digits.slice(5));
  if (/^55\d{2}\d{8}$/.test(digits)) set.add(digits.slice(0,4) + '9' + digits.slice(4));
  return set;
}
function isAllowed(from, allowed) {
  if (!allowed.length) return true;
  const variants = brVariants(from);
  return allowed.some(a => variants.has(a));
}
// Logs nunca mostram o número completo nem o texto das mensagens.
const mask = number => '***' + String(number).slice(-4);

async function graphSend(config, to, text) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), 15_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${config.token}`},
      body:JSON.stringify({messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{preview_url:false, body:text}}),
    });
    if (!response.ok) {
      const detail = await response.json().catch(()=>null);
      throw new Error(`Graph API ${response.status}${detail?.error?.code ? ' código '+detail.error.code : ''}`);
    }
  } finally { clearTimeout(timer); }
}
async function defaultAnswer(text, history) {
  const c = company();
  if (!AI_ENABLED) return demoAnswer(text, c, 'whatsapp');
  try { return await aiAnswer(text, history, c, 'whatsapp'); }
  catch { return 'Desculpe, não consegui responder agora. Pode tentar de novo em instantes?'; }
}

function createWebhook(config, { send=(to,text)=>graphSend(config,to,text), answer=defaultAnswer, log=console } = {}) {
  const seen = new Map();      // id da mensagem -> horário (a Meta pode reenviar o mesmo evento)
  const histories = new Map(); // número -> {at, items}
  const rate = new Map();      // número -> {at, count}
  const pending = new Set();

  function firstTime(id) {
    const now = Date.now();
    if (seen.has(id)) return false;
    seen.set(id, now);
    if (seen.size > 2000) for (const [k,v] of seen) if (now - v > HISTORY_TTL || seen.size > 2000) seen.delete(k);
    return true;
  }
  function withinLimit(from) {
    const now = Date.now(), entry = rate.get(from);
    const value = entry && now - entry.at < 60_000 ? {at:entry.at, count:entry.count+1} : {at:now, count:1};
    rate.set(from, value);
    if (rate.size > 1000) for (const [k,v] of rate) if (now - v.at > 60_000) rate.delete(k);
    return value.count <= 20;
  }
  function historyOf(from) {
    const now = Date.now(), entry = histories.get(from);
    if (entry && now - entry.at < HISTORY_TTL) return entry;
    const fresh = {at:now, items:[]}; histories.set(from, fresh);
    if (histories.size > 500) for (const [k,v] of histories) if (now - v.at > HISTORY_TTL) histories.delete(k);
    return fresh;
  }
  async function handleMessage(msg) {
    const from = String(msg.from || '').replace(/\D/g, '');
    if (!from || !msg.id || !firstTime(msg.id)) return;
    if (!isAllowed(from, config.allowed)) { log.log(`Ignorada: ${mask(from)} fora de WHATSAPP_ALLOWED_NUMBERS.`); return; }
    if (!withinLimit(from)) { log.log(`Limite de mensagens atingido: ${mask(from)}.`); return; }
    if (msg.type !== 'text') { await send(from, 'Por enquanto consigo ler apenas mensagens de texto. Pode escrever sua dúvida?'); return; }
    const text = str(msg.text?.body, 1000);
    if (!text) return;
    const history = historyOf(from);
    const reply = str(await answer(text, history.items.slice(-8)), 1200) || 'Pode repetir, por favor?';
    history.items.push({role:'user', text}, {role:'assistant', text:reply});
    if (history.items.length > 16) history.items.splice(0, history.items.length - 16);
    history.at = Date.now();
    await send(from, reply);
    log.log(`Respondida: ${mask(from)}.`);
  }
  function processPayload(payload) {
    if (payload?.object !== 'whatsapp_business_account') return;
    for (const entry of Array.isArray(payload.entry) ? payload.entry : [])
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value;
        if (change?.field !== 'messages' || !value) continue;
        // Só responde mensagens enviadas ao número configurado; ignora status de entrega.
        if (String(value.metadata?.phone_number_id || '') !== config.phoneNumberId) continue;
        for (const msg of Array.isArray(value.messages) ? value.messages : []) {
          const job = handleMessage(msg).catch(err => log.error(`Falha ao responder: ${err.message}`));
          pending.add(job); job.finally(() => pending.delete(job));
        }
      }
  }
  function reply(res, status, text='') {
    res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'});
    res.end(text);
  }
  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reply(res, 400); }
    if (url.pathname !== ROUTE) return reply(res, 404, 'Não encontrado.');
    if (req.method === 'GET') {
      // Verificação do webhook pela Meta: devolve o desafio só com o token correto.
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && sameSecret(url.searchParams.get('hub.verify_token') || '', config.verifyToken);
      return ok ? reply(res, 200, str(url.searchParams.get('hub.challenge'), 200)) : reply(res, 403, 'Token inválido.');
    }
    if (req.method !== 'POST') return reply(res, 405);
    const chunks = []; let size = 0;
    try {
      for await (const part of req) { size += part.length; if (size > MAX_BODY) return reply(res, 413); chunks.push(part); }
    } catch { return reply(res, 400); }
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'], config.appSecret)) return reply(res, 401, 'Assinatura inválida.');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(res, 400); }
    // A Meta espera 200 rápido; a resposta ao cliente segue em segundo plano.
    reply(res, 200, 'OK');
    processPayload(payload);
  });
  server.idle = () => Promise.all([...pending]);
  return server;
}

if (require.main === module) {
  let config;
  try { config = loadConfig(); }
  catch (err) { console.error(err.message); process.exit(1); }
  const server = createWebhook(config);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  server.on('error', err => { console.error('Falha ao iniciar:', err.message); process.exitCode = 1; });
  server.listen(config.port, HOST, () => {
    console.log(`\nAtende.IA WhatsApp — http://${HOST}:${config.port}${ROUTE}`);
    console.log('Aponte o túnel HTTPS SOMENTE para esta porta. Nunca para a porta do painel.');
    console.log(AI_ENABLED ? `IA: ${MODEL}` : 'IA: respostas de demonstração (defina GEMINI_API_KEY para usar a IA).');
    console.log(config.allowed.length ? `Respondendo apenas ${config.allowed.length} número(s) autorizado(s).` : 'ATENÇÃO: sem WHATSAPP_ALLOWED_NUMBERS, qualquer número que escrever recebe resposta.');
  });
}
module.exports = { createWebhook, loadConfig, validSignature, isAllowed, ROUTE };
