/** Atende.IA — webhook do WhatsApp Cloud API (Meta).
 *  Roda dentro do processo do server.js, mas num servidor HTTP próprio
 *  (127.0.0.1:3012) que só conhece a rota /webhook/whatsapp: o túnel HTTPS aponta
 *  para esta porta, nunca para a do painel. Toda mensagem recebida precisa da
 *  assinatura X-Hub-Signature-256 da Meta. Este módulo não grava arquivos: quem
 *  guarda as conversas é o servidor, pelas funções passadas em `conversas`.
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { str, company, demoAnswer, aiAnswer, AI_ENABLED } = require('./resposta');

const ROUTE = '/webhook/whatsapp';
const HOST = '127.0.0.1';
const MAX_BODY = 256_000;
const HISTORY_TTL = 24 * 60 * 60 * 1000;
const NAMES = {verifyToken:'WHATSAPP_VERIFY_TOKEN',appSecret:'WHATSAPP_APP_SECRET',token:'WHATSAPP_TOKEN',phoneNumberId:'WHATSAPP_PHONE_NUMBER_ID'};

/** Lê a configuração. Retorna null quando nada foi preenchido (WhatsApp desligado). */
function loadConfig(env=process.env) {
  const config = {
    port: Number(env.WHATSAPP_PORT || 3012),
    verifyToken: str(env.WHATSAPP_VERIFY_TOKEN, 200),
    appSecret: str(env.WHATSAPP_APP_SECRET, 200),
    token: str(env.WHATSAPP_TOKEN, 1000),
    phoneNumberId: str(env.WHATSAPP_PHONE_NUMBER_ID, 40),
    graphVersion: str(env.WHATSAPP_GRAPH_VERSION, 10) || 'v25.0',
    // Só para testes automatizados: aponta o envio para um servidor falso local.
    graphBase: str(env.WHATSAPP_GRAPH_BASE, 100) || 'https://graph.facebook.com',
    companyId: str(env.WHATSAPP_EMPRESA_ID, 36),
    allowed: str(env.WHATSAPP_ALLOWED_NUMBERS, 500).split(',').map(x=>x.replace(/\D/g,'')).filter(Boolean),
  };
  const filled = Object.keys(NAMES).filter(k=>config[k]);
  if (!filled.length) return null;
  const missing = Object.keys(NAMES).filter(k=>!config[k]);
  if (missing.length) throw new Error('Configuração do WhatsApp incompleta. Preencha em config-local.bat: '+missing.map(k=>NAMES[k]).join(', '));
  if (config.verifyToken.length < 16) throw new Error('WHATSAPP_VERIFY_TOKEN deve ter pelo menos 16 caracteres.');
  if (!/^\d{5,30}$/.test(config.phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID deve conter apenas números.');
  if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('WHATSAPP_GRAPH_VERSION inválida. Exemplo: v25.0');
  if (!/^(https:\/\/graph\.facebook\.com|http:\/\/127\.0\.0\.1:\d{2,5})$/.test(config.graphBase)) throw new Error('WHATSAPP_GRAPH_BASE inválida.');
  if (config.companyId && !/^[a-f0-9-]{36}$/.test(config.companyId)) throw new Error('WHATSAPP_EMPRESA_ID deve ser o ID de uma empresa cadastrada no painel.');
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
    const response = await fetch(`${config.graphBase}/${config.graphVersion}/${config.phoneNumberId}/messages`, {
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
// Sem servidor (testes do módulo): nada é guardado e o robô sempre responde.
const semRegistro = { entrada: async () => ({modo:'robo'}), saida: async () => {} };

function createWebhook(config, { send=(to,text)=>graphSend(config,to,text), answer=defaultAnswer, conversas=semRegistro, log=console } = {}) {
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
  async function reply(from, text) {
    await send(from, text);
    await conversas.saida({to:from, texto:text, de:'robo'});
  }
  async function handleMessage(msg, nome) {
    const from = String(msg.from || '').replace(/\D/g, '');
    if (!from || !msg.id || !firstTime(msg.id)) return;
    if (!isAllowed(from, config.allowed)) { log.log(`Ignorada: ${mask(from)} fora de WHATSAPP_ALLOWED_NUMBERS.`); return; }
    if (!withinLimit(from)) { log.log(`Limite de mensagens atingido: ${mask(from)}.`); return; }
    const text = msg.type === 'text' ? str(msg.text?.body, 1000) : '';
    const conversa = await conversas.entrada({from, nome:str(nome, 80), texto:text || `[${str(msg.type,20) || 'mensagem'} recebida]`});
    // Com um atendente na conversa, o robô só registra: quem responde é a pessoa.
    if (conversa?.modo === 'humano') { log.log(`Com atendente: ${mask(from)}.`); return; }
    if (msg.type !== 'text') { await reply(from, 'Por enquanto consigo ler apenas mensagens de texto. Pode escrever sua dúvida?'); return; }
    if (!text) return;
    const history = historyOf(from);
    const answerText = str(await answer(text, history.items.slice(-8)), 1200) || 'Pode repetir, por favor?';
    history.items.push({role:'user', text}, {role:'assistant', text:answerText});
    if (history.items.length > 16) history.items.splice(0, history.items.length - 16);
    history.at = Date.now();
    await reply(from, answerText);
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
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        for (const msg of Array.isArray(value.messages) ? value.messages : []) {
          const nome = contacts.find(c => c?.wa_id === msg?.from)?.profile?.name || '';
          // Uma mensagem por vez: a ordem de chegada é preservada na conversa.
          const job = (pending.size ? Promise.all([...pending]) : Promise.resolve())
            .then(() => handleMessage(msg, nome))
            .catch(err => log.error(`Falha ao responder: ${err.message}`));
          pending.add(job); job.finally(() => pending.delete(job));
        }
      }
  }
  function respond(res, status, text='') {
    res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'});
    res.end(text);
  }
  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return respond(res, 400); }
    if (url.pathname !== ROUTE) return respond(res, 404, 'Não encontrado.');
    if (req.method === 'GET') {
      // Verificação do webhook pela Meta: devolve o desafio só com o token correto.
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && sameSecret(url.searchParams.get('hub.verify_token') || '', config.verifyToken);
      const challenge = url.searchParams.get('hub.challenge') || '';
      return ok && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? respond(res, 200, challenge) : respond(res, 403, 'Token inválido.');
    }
    if (req.method !== 'POST') return respond(res, 405);
    const chunks = []; let size = 0;
    try {
      for await (const part of req) { size += part.length; if (size > MAX_BODY) return respond(res, 413); chunks.push(part); }
    } catch { return respond(res, 400); }
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'], config.appSecret)) return respond(res, 401, 'Assinatura inválida.');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return respond(res, 400); }
    // A Meta espera 200 rápido; a resposta ao cliente segue em segundo plano.
    respond(res, 200, 'OK');
    processPayload(payload);
  });
  server.idle = async () => { while (pending.size) await Promise.all([...pending]); };
  return server;
}

module.exports = { createWebhook, loadConfig, graphSend, validSignature, isAllowed, mask, ROUTE, HOST };
