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
  return graphSendPayload(config,{messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{preview_url:false, body:text}});
}
async function graphSendPayload(config, payload) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.graphBase}/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${config.token}`},
      body:JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.json().catch(()=>null);
      throw new Error(`Graph API ${response.status}${detail?.error?.code ? ' código '+detail.error.code : ''}`);
    }
  } finally { clearTimeout(timer); }
}
// Um único acumulador de categorias fixas: nenhuma fila por IP/URL controlável pelo visitante.
// Alertas não persistem dados pessoais e nunca incluem requisições, senhas ou tokens.
function createSecurityAlerts(config, {env=process.env, send=graphSendPayload, now=Date.now, log=console}={}) {
  const enabled=env.SECURITY_WHATSAPP_ENABLED==='1';
  const categories=['rate_limit','login_limit','overload','payload_limit'];
  let counts={},pending=false,nextSend=0;
  const empty=()=>Object.fromEntries(categories.map(k=>[k,0]));
  counts=empty();
  if(!enabled)return {record(){},flush:async()=>false,enabled:false};
  const to=String(env.SECURITY_WHATSAPP_TO||'');
  const template=String(env.SECURITY_WHATSAPP_TEMPLATE||'');
  const language=String(env.SECURITY_WHATSAPP_LANGUAGE||'pt_BR');
  if(!config || !/^55[1-9]\d9\d{8}$/.test(to) || !/^[a-z0-9_]{1,100}$/.test(template) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) {
    throw new Error('Alertas WhatsApp: configure integração, destinatário celular brasileiro completo e modelo aprovado.');
  }
  function record(category){if(categories.includes(category))counts[category]=Math.min(counts[category]+1,1_000_000);}
  async function flush(){
    if(pending || now()<nextSend || Object.values(counts).reduce((a,b)=>a+b,0)<20)return false;
    const snapshot=counts;counts=empty();pending=true;nextSend=now()+5*60_000;
    const summary=`Atividade suspeita (não confirma invasão). Requisições limitadas: ${snapshot.rate_limit}; login limitado: ${snapshot.login_limit}; sobrecarga: ${snapshot.overload}; tamanho excessivo: ${snapshot.payload_limit}. Consulte o administrador.`;
    try {
      await send(config,{messaging_product:'whatsapp',to,type:'template',template:{name:template,language:{code:language},components:[{type:'body',parameters:[{type:'text',text:summary}]}]}});
      // API aceitar não comprova entrega ao aparelho.
      log.log('Alerta de segurança aceito pela API do WhatsApp.');
      return true;
    } catch {
      for(const key of categories)counts[key]=Math.min(counts[key]+snapshot[key],1_000_000);
      log.error('Falha ao enviar alerta de segurança; nova tentativa após o intervalo.');
      return false;
    } finally {pending=false;}
  }
  return {record,flush,enabled:true};
}
// dadosEmpresa: "Dados da empresa" do WHATSAPP_EMPRESA_ID (o server.js lê só dessa empresa), ou null.
async function defaultAnswer(text, history, cfg, dadosEmpresa=null) {
  const c = company(cfg);
  if (!AI_ENABLED) return demoAnswer(text, c, dadosEmpresa);
  try { return await aiAnswer(text, history, c, 'whatsapp', dadosEmpresa); }
  catch (err) {
    // Teto diário da IA: segue atendendo com as respostas prontas da empresa.
    if (err.code === 'limite_ia') return demoAnswer(text, c, dadosEmpresa);
    return 'Desculpe, não consegui responder agora. Pode tentar de novo em instantes?';
  }
}
// Sem servidor (testes do módulo): nada é guardado e o robô sempre responde.
const semRegistro = { entrada: async () => ({modo:'robo'}), saida: async () => {} };

// Limite por IP do webhook só para o que vem SEM assinatura válida (GET de verificação, POST sem
// X-Hub-Signature-256 ou com assinatura errada): lixo enviado pelo túnel não barra os eventos da Meta.
// O que vem assinado fica limitado pelo teto de tamanho, pelas conexões e pelos tempos limite.
const LIMITE_IP_MINUTO = 300;
const LIMITE_IP_CHAVES = 1024;
// ipDe(req): o server.js passa o visitante() dele (proxy confiável e IPv6 agrupado por /64).
function createWebhook(config, { send=(to,text)=>graphSend(config,to,text), answer=defaultAnswer, conversas=semRegistro, log=console, ipDe=req=>req.socket.remoteAddress||'unknown' } = {}) {
  const porIp = new Map();     // ip -> {expires, count}; cheia, descarta primeiro as não bloqueadas
  function ipBloqueado(ip) {
    const entry = porIp.get(ip);
    return !!entry && Date.now() < entry.expires && entry.count > LIMITE_IP_MINUTO;
  }
  function ipDentroDoLimite(ip) {
    const now = Date.now();
    let entry = porIp.get(ip);
    if (entry && now >= entry.expires) { porIp.delete(ip); entry = null; }
    if (!entry && porIp.size >= LIMITE_IP_CHAVES) {
      for (const [k,v] of porIp) if (now >= v.expires) porIp.delete(k);
      let sobra = porIp.size - LIMITE_IP_CHAVES + Math.ceil(LIMITE_IP_CHAVES/10);
      if (porIp.size >= LIMITE_IP_CHAVES) for (const [k,v] of porIp) { if (sobra <= 0) break; if (v.count <= LIMITE_IP_MINUTO) { porIp.delete(k); sobra--; } }
      if (porIp.size >= LIMITE_IP_CHAVES) for (const k of porIp.keys()) { if (sobra-- <= 0) break; porIp.delete(k); }
    }
    const value = entry ? {expires:entry.expires, count:Math.min(entry.count+1, LIMITE_IP_MINUTO+1)} : {expires:now+60_000, count:1};
    porIp.set(ip, value);
    return value.count <= LIMITE_IP_MINUTO;
  }
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
    const conversa = await conversas.entrada({from, nome:str(nome, 80), texto:text || `[${str(msg.type,20) || 'mensagem'} recebida]`, idMeta:str(msg.id,200)});
    // Reenvio da Meta já registrado (inclusive antes de um reinício): não responde de novo.
    if (conversa?.duplicada) return;
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
    const ip = ipDe(req);
    const excesso = () => { res.setHeader('Retry-After', '60'); res.setHeader('Connection', 'close'); return respond(res, 429, 'Muitas solicitações.'); };
    // GET e outros métodos não têm assinatura: contam no limite por IP.
    if (req.method !== 'POST' && !ipDentroDoLimite(ip)) return excesso();
    // POST sem assinatura de um IP já barrado: recusa sem ler o corpo.
    if (req.method === 'POST' && !req.headers['x-hub-signature-256'] && ipBloqueado(ip)) return excesso();
    if (req.method === 'GET') {
      // Verificação do webhook pela Meta: devolve o desafio só com o token correto.
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && sameSecret(url.searchParams.get('hub.verify_token') || '', config.verifyToken);
      const challenge = url.searchParams.get('hub.challenge') || '';
      return ok && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? respond(res, 200, challenge) : respond(res, 403, 'Token inválido.');
    }
    if (req.method !== 'POST') return respond(res, 405);
    // Tamanho declarado acima do limite: recusa sem ler o corpo.
    if (Number(req.headers['content-length']) > MAX_BODY) { res.setHeader('Connection', 'close'); return respond(res, 413); }
    const chunks = []; let size = 0;
    try {
      for await (const part of req) { size += part.length; if (size > MAX_BODY) return respond(res, 413); chunks.push(part); }
    } catch { return respond(res, 400); }
    const raw = Buffer.concat(chunks);
    // HMAC barato: só o que falha aqui conta no limite por IP.
    if (!validSignature(raw, req.headers['x-hub-signature-256'], config.appSecret)) return ipDentroDoLimite(ip) ? respond(res, 401, 'Assinatura inválida.') : excesso();
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return respond(res, 400); }
    // A Meta espera 200 rápido; a resposta ao cliente segue em segundo plano.
    respond(res, 200, 'OK');
    processPayload(payload);
  });
  // Mesmo padrão do server.js: limita conexões lentas, cabeçalhos e reutilização de conexões.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxHeadersCount = 64;
  server.maxConnections = 128;
  server.setTimeout(30_000, socket => socket.destroy());
  server.idle = async () => { while (pending.size) await Promise.all([...pending]); };
  return server;
}

module.exports = { createWebhook, defaultAnswer, loadConfig, graphSend, createSecurityAlerts, validSignature, isAllowed, mask, ROUTE, HOST };
