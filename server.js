/** Atende.IA v0.3.8.3 — demonstração LOCAL com autenticação e permissões reais no servidor.
 *  Node.js 22+. Não expor na internet: HTTPS, MFA, banco transacional,
 *  backups protegidos e revisão de segurança ainda são necessários.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { read, update, ROOT, DATA, acquireServerLock } = require('./store');
const auth = require('./auth');
const { AI_ENABLED, MODEL, bad, str, company, normalize, demoAnswer, aiAnswer } = require('./resposta');
const whatsapp = require('./whatsapp');
const conversas = require('./conversas');
// null quando o WhatsApp não foi configurado; configuração pela metade impede a partida.
const WPP = whatsapp.loadConfig(process.env);

const SITE_PUBLICO = path.join(ROOT, 'site', 'publico');
const SITE_INTERNO = path.join(ROOT, 'site', 'interno');
const PORT = Number(process.env.PORT || 3011);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('PORT inválida');
const HOST = '127.0.0.1';
// O protótipo permanece local. Não abrir HOST=0.0.0.0 com o servidor atual.
// SITE_ORIGIN ativa metadados e sitemap somente após um domínio HTTPS real e revisão de segurança.
const SITE_ORIGIN = (()=>{
  if(!process.env.SITE_ORIGIN) return null;
  const u = new URL(process.env.SITE_ORIGIN);
  if(u.protocol!=='https:' || u.pathname!=='/' || u.search || u.hash || u.username || u.password) throw new Error('SITE_ORIGIN deve ser uma origem HTTPS sem caminho.');
  return u.origin;
})();
const rate = new Map();
// Apenas o hostname explicitamente configurado para Tailscale Serve e aceito.
// NUNCA aceitar qualquer *.ts.net e nunca confiar em X-Forwarded-Host.
const TAILSCALE_HOST = String(process.env.TAILSCALE_HOST || '').trim().toLowerCase();
if (TAILSCALE_HOST && !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(TAILSCALE_HOST)) {
  throw new Error('TAILSCALE_HOST inválido. Informe somente o domínio completo *.ts.net, sem https:// nem barras.');
}
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  ...(TAILSCALE_HOST ? [TAILSCALE_HOST, `${TAILSCALE_HOST}:443`] : [])
]);
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(TAILSCALE_HOST ? [`https://${TAILSCALE_HOST}`] : [])
]);
function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
}
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
// Erros em navegação HTML não devem ser tratados como arquivos JSON pelo Safari.
// As APIs continuam respondendo em JSON para que o JavaScript processe falhas.
function errorResponse(req, res, status, message) {
  const navigation = (req.method === 'GET' || req.method === 'HEAD')
    && /(?:^|,)\s*text\/html(?:[;,]|$)/i.test(String(req.headers.accept || ''))
    && !String(req.url || '').startsWith('/api/');
  if (!navigation) return json(res, status, {error:message});
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Acesso indisponível | Atende.IA</title></head><body><main><h1>Acesso indisponível</h1><p>${escapeHtml(message)}</p><p>Confirme o endereço autorizado e a configuração do servidor.</p></main></body></html>`;
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
  return res.end(req.method==='HEAD'?'':html);
}
async function body(req, max=16_000) {
  const chunks=[]; let size=0;
  for await (const part of req) { size+=part.length; if(size>max) throw bad(413,'Dados muito grandes.'); chunks.push(part); }
  let value;
  try { value=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad(400,'JSON inválido.'); }
  if (!value || typeof value!=='object' || Array.isArray(value)) throw bad(400,'Conteúdo inválido.');
  return value;
}
function throttle(key, max=80, windowMs=60_000) {
  const now=Date.now(), entry=rate.get(key);
  const value=entry && now-entry.at<windowMs ? {at:entry.at, count:entry.count+1} : {at:now,count:1};
  rate.set(key,value);
  if (rate.size>1000) for (const [k,v] of rate) if(now-v.at>windowMs) rate.delete(k);
  return value.count<=max;
}
function csrf(req, session) { if (!session || req.headers['x-csrf-token']!==session.csrf) throw bad(403,'Token de segurança inválido. Atualize a página.'); }
function allow(session, roles) {
  if(!session) throw bad(401,'É necessário fazer login.');
  if(session.user.mustChangePassword) throw bad(403,'Troque sua senha provisória para continuar.');
  if(!roles.includes(session.user.role)) throw bad(403,'Seu perfil não tem acesso a esta função.');
  return session.user;
}
// Toda solicitação pertence a uma empresa. Administradores gerais veem todas;
// atendimento e clientes veem apenas a empresa atribuída no servidor.
function inCompany(user, item) {
  return user.role==='admin' || (Boolean(user.companyId) && user.companyId===item.companyId);
}
function requireCompany(user) {
  if(user.role!=='admin' && !user.companyId) throw bad(403,'Seu usuário ainda não está vinculado a uma empresa.');
}
const PLANS={
  essencial:{label:'Essencial',setupCents:49000,monthlyCents:19900},
  profissional:{label:'Profissional',setupCents:89000,monthlyCents:39900},
  personalizado:{label:'Sob medida',setupCents:null,monthlyCents:null}
};
const SUB_STATUSES=['teste','ativa','atrasada','suspensa','cancelada'];
const UF_CODES='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const BRAZIL_TZ=['America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'];
function companyRegion(input){
  const city=str(input.city,80),uf=str(input.uf,2).toUpperCase(),timeZone=str(input.timeZone,40);
  if(city.length<2||!UF_CODES.includes(uf)||!BRAZIL_TZ.includes(timeZone))throw bad(400,'Informe cidade, UF e fuso horário brasileiro válidos.');
  return {city,uf,timeZone};
}

function moneyCents(v){ if(!Number.isInteger(v)||v<0||v>100_000_000) throw bad(400,'Valor deve ser informado em centavos, de 0 até 1.000.000 reais.');return v; }
function safeDate(v){ if(v===''||v===null||v===undefined)return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v) throw bad(400,'Data inválida: use AAAA-MM-DD.');return v; }
function subscription(input){
  const plan=str(input.plan,30),status=str(input.status,30);
  if(!PLANS[plan]||!SUB_STATUSES.includes(status))throw bad(400,'Plano ou situação inválida.');
  return {plan,status,setupCents:moneyCents(input.setupCents),monthlyCents:moneyCents(input.monthlyCents),nextDueDate:safeDate(input.nextDueDate),updatedAt:new Date().toISOString(),paymentIntegration:false};
}
async function companyExists(companyId){return Boolean((await read('empresas.json')).find(x=>x.id===companyId));}
// Atualização única de cadastros locais antigos: preserva usuários e chamados.
// Dados anteriores vão para um ambiente de demonstração explicitamente identificado.
async function migrateLegacy(){
  const [users,requests]=await Promise.all([read(auth.USERFILE),read('solicitacoes.json')]);
  const hasOld=users.some(x=>x.role!=='admin'&&!x.companyId)||requests.some(x=>!x.companyId);
  if(!hasOld)return;
  const legacyId='00000000-0000-4000-8000-000000000001';
  await update('empresas.json',list=>{if(!list.some(x=>x.id===legacyId))list.push({id:legacyId,name:'Ambiente de testes anterior',city:'Não informado',uf:'SC',timeZone:'America/Sao_Paulo',contact:'',notes:'Migração local dos testes anteriores. Não é cliente real.',state:'em_configuracao',subscription:{plan:'essencial',status:'teste',setupCents:49000,monthlyCents:19900,nextDueDate:null,updatedAt:new Date().toISOString(),paymentIntegration:false},createdAt:new Date().toISOString()});});
  await update(auth.USERFILE,list=>{for(const u of list)if(u.role!=='admin'&&!u.companyId)u.companyId=legacyId;});
  await update('solicitacoes.json',list=>{for(const r of list)if(!r.companyId)r.companyId=legacyId;});
  console.log('Dados antigos migrados para Ambiente de testes anterior.');
}
function safeStatus(status) { if (!['novo','em_andamento','aguardando_cliente','resolvido'].includes(status)) throw bad(400,'Status inválido.'); return status; }
async function logLoginAttempt(username, result, reason) {
  // Nenhuma senha, token ou cookie é registrado. Dados limitados à demonstração local.
  await update('tentativas-login.json', items=>{
    items.push({at:new Date().toISOString(),username:str(username,30).toLowerCase(),result,reason:str(reason,110)});
    if(items.length>700) items.splice(0,items.length-700);
  });
}
function newMessage(author, role, content, internal=false) { return {id:crypto.randomUUID(),author,role,content,internal,createdAt:new Date().toISOString()}; }
function stripRequest(item, role) {
  return { ...item, messages:role==='cliente' ? item.messages.filter(m=>!m.internal) : item.messages };
}
async function audit(action, actor, detail='') {
  await update('auditoria.json', list=>{ list.push({at:new Date().toISOString(),action,actor,detail:str(detail,200)}); if(list.length>1500) list.splice(0,list.length-1500); });
}
// Lista explícita do que pode ser servido; os arquivos internos ficam em pasta separada.
// Uma URL conhecida NÃO autoriza um usuário: as páginas e APIs exigem sessão e perfil.
const assets={
  '/':['publico','index.html','text/html; charset=utf-8'],
  '/index.html':['publico','index.html','text/html; charset=utf-8'],
  '/favicon.webp':['publico','favicon.webp','image/webp'],
  '/privacidade':['publico','privacidade.html','text/html; charset=utf-8'],
  '/termos':['publico','termos.html','text/html; charset=utf-8'],
  '/style.css':['publico','style.css','text/css; charset=utf-8'],
  '/app.js':['publico','app.js','text/javascript; charset=utf-8'],
  '/painel.css':['interno','painel.css','text/css; charset=utf-8'],
  '/painel.js':['interno','painel.js','text/javascript; charset=utf-8'],
  '/empresas.js':['interno','empresas.js','text/javascript; charset=utf-8'],
  '/acesso':['interno','acesso.html','text/html; charset=utf-8'],
  '/cliente':['interno','cliente.html','text/html; charset=utf-8'],
  '/atendimento':['interno','atendimento.html','text/html; charset=utf-8'],
  '/admin':['interno','admin.html','text/html; charset=utf-8']
};
function requirePage(pathname, s) {
  if(pathname==='/empresas.js') return s && s.user.role==='admin' && !s.user.mustChangePassword;
  if(pathname==='/cliente') return s && s.user.role==='cliente' && !s.user.mustChangePassword;
  if(pathname==='/atendimento') return s && ['atendimento','admin'].includes(s.user.role) && !s.user.mustChangePassword;
  if(pathname==='/admin') return s && s.user.role==='admin' && !s.user.mustChangePassword;
  return true;
}
const server=http.createServer(async (req,res)=>{
  securityHeaders(res);
  try {
    const host=String(req.headers.host||'').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) throw bad(403,'Endereço de acesso não permitido.');
    const url=new URL(req.url,'http://localhost'); const pathname=url.pathname;
    const s=await auth.session(req);
    if ((req.method==='GET'||req.method==='HEAD') && pathname==='/robots.txt') {
      // Local: não indexar protótipo. Produção: indexar apenas conteúdo público.
      const content=SITE_ORIGIN
        ? 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /atendimento\nDisallow: /cliente\nDisallow: /acesso\nSitemap: '+SITE_ORIGIN+'/sitemap.xml\n'
        : 'User-agent: *\nDisallow: /\n';
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'});
      return res.end(req.method==='HEAD'?'':content);
    }
    if ((req.method==='GET'||req.method==='HEAD') && pathname==='/sitemap.xml' && SITE_ORIGIN) {
      const content='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        +[SITE_ORIGIN+'/',SITE_ORIGIN+'/privacidade',SITE_ORIGIN+'/termos'].map(x=>'<url><loc>'+x+'</loc></url>').join('\n')+'\n</urlset>';
      res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'});
      return res.end(req.method==='HEAD'?'':content);
    }
    if ((req.method==='GET'||req.method==='HEAD') && assets[pathname]) {
      if (!requirePage(pathname,s)) { res.writeHead(302,{Location:'/acesso','Cache-Control':'no-store'});return res.end(); }
      const [area,filename,mime]=assets[pathname];
      const raiz=area==='publico'?SITE_PUBLICO:SITE_INTERNO;
      let buffer=await fs.readFile(path.join(raiz,filename));
      const publicPage=area==='publico' && mime.startsWith('text/html');
      const staticPublic=area==='publico' && !publicPage;
      if (staticPublic) { res.removeHeader('Pragma'); res.removeHeader('Expires'); }
      if (publicPage && SITE_ORIGIN) {
        const destination=SITE_ORIGIN+(pathname==='/index.html'?'/':pathname);
        const jsonLd=JSON.stringify({'@context':'https://schema.org','@type':'SoftwareApplication',name:'Atende.IA',applicationCategory:'BusinessApplication',operatingSystem:'Web',url:SITE_ORIGIN+'/',description:'Demonstração de um sistema de atendimento automatizado para sites.'});
        buffer=Buffer.from(buffer.toString('utf8').replace('</head>',`<link rel="canonical" href="${destination}"><meta property="og:url" content="${destination}">${pathname==='/'||pathname==='/index.html'?`<script type="application/ld+json">${jsonLd}</script>`:''}</head>`));
      }
      const etag=staticPublic?'W/"'+crypto.createHash('sha256').update(buffer).digest('hex').slice(0,24)+'"':null;
      if(etag && req.headers['if-none-match']===etag) {
        res.writeHead(304,{'ETag':etag,'Cache-Control':'public, max-age=86400','Vary':'Accept-Encoding'});return res.end();
      }
      const headers={'Content-Type':mime,'Cache-Control':staticPublic?'public, max-age=86400':'no-store'};
      if(etag) headers.ETag=etag;
      if(!SITE_ORIGIN || area==='interno') headers['X-Robots-Tag']='noindex, nofollow, noarchive';
      // Comprime HTML/CSS/JS, inclusive em conexão lenta. Imagem WebP já é comprimida.
      if(mime.startsWith('text/') && /\bgzip\b/.test(req.headers['accept-encoding']||'')) {
        buffer=zlib.gzipSync(buffer,{level:6});
        headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding';
      }
      res.writeHead(200,headers);
      return res.end(req.method==='HEAD'?'':buffer);
    }
    if (req.method==='GET' && pathname==='/api/status') return json(res,200,{ai:AI_ENABLED,local:true,version:'0.3.8.3'});
    if (req.method==='GET' && pathname==='/api/company') return json(res,200,company());
    if (req.method==='GET' && pathname==='/api/auth/me') return json(res,200,{user:s?auth.safeUser(s.user):null,csrf:s?.csrf||null});
    if (req.method==='GET' && pathname==='/api/my-company') {
      const u=allow(s,['cliente','atendimento']);requireCompany(u);
      const c=(await read('empresas.json')).find(x=>x.id===u.companyId);
      if(!c)throw bad(404,'Empresa não encontrada.');
      return json(res,200,{name:c.name,city:c.city||'',uf:c.uf||''});
    }

    // Todas as rotas privadas requerem sessão válida e permissões no servidor.
    if (req.method==='GET' && pathname.startsWith('/api/')) {
      if (pathname==='/api/portal/requests') {
        const user=allow(s,['cliente']);requireCompany(user);const list=await read('solicitacoes.json');
        return json(res,200,{items:list.filter(x=>x.ownerId===user.id&&inCompany(user,x)).map(x=>({id:x.id,subject:x.subject,status:x.status,priority:x.priority,updatedAt:x.updatedAt}))});
      }
      const requestMatch=pathname.match(/^\/api\/(portal|staff)\/requests\/([a-f0-9-]{36})$/);
      if (requestMatch) {
        const mode=requestMatch[1],user=allow(s,mode==='portal'?['cliente']:['atendimento','admin']);
        const request=(await read('solicitacoes.json')).find(x=>x.id===requestMatch[2]);
        if (!request || !inCompany(user,request) || (mode==='portal' && request.ownerId!==user.id)) throw bad(404,'Solicitação não encontrada.');
        return json(res,200,{item:stripRequest(request,mode==='portal'?'cliente':user.role)});
      }
      if (pathname==='/api/staff/requests') {
        const user=allow(s,['atendimento','admin']);requireCompany(user);
        const status=str(url.searchParams.get('status'),50),search=normalize(str(url.searchParams.get('search'),100));
        let list=(await read('solicitacoes.json')).filter(x=>inCompany(user,x)&&(!status||x.status===status)&&(!search||normalize([x.subject,x.customerName,x.description,x.id].join(' ')).includes(search)));
        list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        return json(res,200,{items:list.map(x=>({id:x.id,subject:x.subject,status:x.status,priority:x.priority,customerName:x.customerName,assignedTo:x.assignedTo,updatedAt:x.updatedAt}))});
      }
      if (pathname==='/api/staff/stats') {
        const user=allow(s,['atendimento','admin']);requireCompany(user);const list=(await read('solicitacoes.json')).filter(x=>inCompany(user,x));
        return json(res,200,{total:list.length,novo:list.filter(x=>x.status==='novo').length,em_andamento:list.filter(x=>x.status==='em_andamento').length,aguardando_cliente:list.filter(x=>x.status==='aguardando_cliente').length,resolvido:list.filter(x=>x.status==='resolvido').length});
      }
      if (pathname==='/api/staff/leads') {
        const user=allow(s,['atendimento','admin']);requireCompany(user);
        if(user.role!=='admin')return json(res,200,{items:[],notice:'Contatos antigos de demonstração não estão vinculados a empresas.'});
        const [samples,commercial]=await Promise.all([read('leads-demonstracao.json'),read('interesses-comerciais-teste.json')]);
        return json(res,200,{items:[...samples.map(x=>({...x,kind:'orçamento (teste)'})),...commercial.map(x=>({...x,kind:'comercial (teste)'}))].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))});
      }
      // Conversas do WhatsApp: admin vê todas; atendimento só as da empresa do número.
      if (pathname==='/api/staff/whatsapp') {
        const user=allow(s,['atendimento','admin']);requireCompany(user);
        if(!WPP) return json(res,200,{enabled:false,items:[]});
        const list=(await conversas.listar()).filter(c=>inCompany(user,c));
        list.sort((a,b)=>(b.atualizadoEm||'').localeCompare(a.atualizadoEm||''));
        return json(res,200,{enabled:true,items:list.map(conversas.resumo)});
      }
      const wppMatch=pathname.match(/^\/api\/staff\/whatsapp\/([a-f0-9-]{36})$/);
      if (wppMatch) {
        const user=allow(s,['atendimento','admin']);requireCompany(user);
        const c=(await conversas.listar()).find(x=>x.id===wppMatch[1]);
        if(!c||!inCompany(user,c)) throw bad(404,'Conversa não encontrada.');
        return json(res,200,{item:conversas.completa(c)});
      }
      if (pathname==='/api/admin/plans') {allow(s,['admin']);return json(res,200,{plans:PLANS, statuses:SUB_STATUSES,automaticBilling:false});}
      if (pathname==='/api/admin/companies') {allow(s,['admin']);return json(res,200,{items:await read('empresas.json')});}
      if (pathname==='/api/admin/users') {
        allow(s,['admin']);return json(res,200,{items:(await read(auth.USERFILE)).map(auth.safeUser)});
      }
      if (pathname==='/api/admin/audit') { allow(s,['admin']);return json(res,200,{items:(await read('auditoria.json')).slice(-100).reverse()}); }
      if (pathname==='/api/admin/security') {
        allow(s,['admin']);
        const [users,events]=await Promise.all([read(auth.USERFILE),read('tentativas-login.json')]);
        const blocked=auth.blockedAccounts().map(lock=>{
          const user=users.find(u=>u.username===lock.username);
          return {...lock,name:user?.name||'Usuário não cadastrado',id:user?.id||null};
        });
        const since=Date.now()-24*60*60_000;
        const last24=events.filter(e=>Date.parse(e.at)>=since);
        return json(res,200,{blocked,events:events.slice(-100).reverse(),summary:{locked:blocked.length,failed:last24.filter(e=>e.result==='falha').length,blockedAttempts:last24.filter(e=>e.result==='bloqueado').length,successful:last24.filter(e=>e.result==='sucesso').length}});
      }
      if (pathname==='/api/admin/config') { allow(s,['admin']);return json(res,200,{config:company()}); }
      if (pathname==='/api/admin/health') {
        allow(s,['admin']);const users=await read(auth.USERFILE),reqs=await read('solicitacoes.json');
        return json(res,200,{mode:'LOCAL — não publicar',users:users.length,requests:reqs.length,sessions:'somente na memória',database:'Arquivos JSON locais; backup manual necessário',ai:AI_ENABLED});
      }
    }
    if (req.method!=='POST' && req.method!=='PUT') throw bad(404,'Rota não encontrada.');
    if (!ALLOWED_ORIGINS.has(req.headers.origin)) throw bad(403,'Origem não permitida.');
    if (!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) throw bad(415,'Envie JSON.');
    if (!throttle(`${req.socket.remoteAddress}:all`,100)) throw bad(429,'Muitas solicitações.');
    if (pathname==='/api/auth/login' && !throttle(`${req.socket.remoteAddress}:login`,40,15*60_000)) throw bad(429,'Muitas tentativas de acesso.');
    const input=await body(req);
    if (pathname==='/api/auth/login') {
      const username=str(input.username,30).toLowerCase(),password=input.password;
      if (!username || typeof password!=='string') throw bad(400,'Informe usuário e senha.');
      if (auth.locked(username)) {
        await logLoginAttempt(username,'bloqueado','Conta temporariamente bloqueada por tentativas incorretas');
        await audit('login_bloqueado',username,'Tentativa durante bloqueio temporário');
        throw bad(429,'Muitas tentativas para esta conta. Tente novamente mais tarde.');
      }
      const user=(await read(auth.USERFILE)).find(x=>x.username===username && x.active);
      if(!user || !auth.verifyPassword(password,user)) {
        auth.fail(username);
        const justLocked=Boolean(auth.lockInfo(username));
        await logLoginAttempt(username,'falha',justLocked?'Limite de 5 tentativas incorretas atingido':'Usuário inexistente, inativo ou senha incorreta');
        await audit(justLocked?'login_bloqueio_acionado':'login_falhou',username,justLocked?'Conta temporariamente bloqueada':'Credenciais inválidas');
        throw bad(401,'Usuário ou senha inválidos.');
      }
      auth.forget(username);auth.clearSession(req,res);
      const csrfToken=auth.newSession(res,user);
      await logLoginAttempt(user.username,'sucesso','Autenticação realizada');
      await audit('login',user.username);
      return json(res,200,{user:auth.safeUser(user),csrf:csrfToken});
    }
    if(pathname==='/api/chat') {
      if (!throttle(`${req.socket.remoteAddress}:chat`,30)) throw bad(429,'Limite de mensagens.');
      const msg=str(input.message,1000);
      if(!msg) throw bad(400,'Digite uma mensagem.');
      const history=Array.isArray(input.history)?input.history.filter(h=>h&&['user','assistant'].includes(h.role)&&typeof h.text==='string').slice(-8):[];
      if(!AI_ENABLED) return json(res,200,{answer:demoAnswer(msg,company()),ai:false});
      return json(res,200,{answer:await aiAnswer(msg,history,company()),ai:true});
    }
    if(pathname==='/api/lead' || pathname==='/api/commercial-lead') {
      if (!throttle(`${req.socket.remoteAddress}:lead`,15)) throw bad(429,'Limite de cadastros de teste.');
      if(input.consent!==true) throw bad(400,'Confirme o uso de dados fictícios.');
      const isQuote=pathname==='/api/lead';
      const data=isQuote?{name:str(input.name,90),phone:str(input.phone,30),city:str(input.city,90),service:str(input.service,150)}:{company:str(input.company,100),name:str(input.name,90),contact:str(input.contact,120),need:str(input.need,250)};
      if(Object.values(data).some(v=>v.length<2)) throw bad(400,'Preencha os campos do teste.');
      if(isQuote && !/^[+()\d\s-]{10,30}$/.test(data.phone)) throw bad(400,'Telefone de teste inválido.');
      await update(isQuote?'leads-demonstracao.json':'interesses-comerciais-teste.json', list=>{list.push({id:crypto.randomUUID(),...data,consent:true,createdAt:new Date().toISOString()});});
      return json(res,201,{ok:true});
    }

    // Rotas de escrita autenticadas: CSRF e regra de função obrigatórios.
    if (!s) throw bad(401,'Sessão encerrada. Entre novamente.');
    csrf(req,s);
    if(pathname==='/api/auth/logout') { auth.clearSession(req,res);await audit('logout',s.user.username);return json(res,200,{ok:true}); }
    if(pathname==='/api/auth/change-password') {
      if(typeof input.currentPassword!=='string' || !auth.verifyPassword(input.currentPassword,s.user)) throw bad(401,'Senha atual incorreta.');
      if(!auth.passwordValid(input.newPassword)) throw bad(400,'A nova senha deve ter 12 a 128 caracteres.');
      if(input.newPassword===input.currentPassword) throw bad(400,'Use uma senha diferente.');
      await update(auth.USERFILE, users=>{ const u=users.find(x=>x.id===s.user.id);Object.assign(u,auth.hashPassword(input.newPassword),{mustChangePassword:false}); });
      auth.revokeUser(s.user.id);auth.clearSession(req,res);await audit('senha_alterada',s.user.username);
      return json(res,200,{ok:true,relogin:true});
    }
    if(pathname==='/api/portal/requests') {
      const user=allow(s,['cliente']);requireCompany(user);
      const subject=str(input.subject,100),description=str(input.description,2000);
      if(subject.length<5||description.length<10) throw bad(400,'Informe assunto (5+) e descrição (10+).');
      const item={id:crypto.randomUUID(),companyId:user.companyId,ownerId:user.id,customerName:user.name,subject,description,status:'novo',priority:'normal',assignedTo:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[newMessage(user.name,'cliente',description)]};
      await update('solicitacoes.json',list=>{list.push(item)});await audit('solicitacao_criada',user.username,item.id);
      return json(res,201,{item:stripRequest(item,'cliente')});
    }
    const msgMatch=pathname.match(/^\/api\/(portal|staff)\/requests\/([a-f0-9-]{36})\/messages$/);
    if(msgMatch) {
      const mode=msgMatch[1],user=allow(s,mode==='portal'?['cliente']:['atendimento','admin']);
      const content=str(input.content,2000),internal=mode==='staff' && input.internal===true;
      if(content.length<2) throw bad(400,'Mensagem muito curta.');
      const item=await update('solicitacoes.json',list=>{
        const x=list.find(x=>x.id===msgMatch[2]&&(mode==='staff'||x.ownerId===user.id));
        if(!x || !inCompany(user,x)) throw bad(404,'Solicitação não encontrada.');
        x.messages.push(newMessage(user.name,user.role,content,internal));x.updatedAt=new Date().toISOString();
        if(mode==='portal' && x.status==='aguardando_cliente') x.status='em_andamento';
        return stripRequest(x,mode==='portal'?'cliente':user.role);
      });
      await audit(internal?'nota_interna':'resposta',user.username,item.id);return json(res,201,{item});
    }
    const stateMatch=pathname.match(/^\/api\/staff\/requests\/([a-f0-9-]{36})\/(status|priority|assign)$/);
    if(stateMatch) {
      const user=allow(s,['atendimento','admin']);requireCompany(user);const action=stateMatch[2];
      const value=action==='status'?safeStatus(input.value):action==='priority'?str(input.value,20):str(input.value,50);
      if(action==='priority'&&!['baixa','normal','alta'].includes(value)) throw bad(400,'Prioridade inválida.');
      if(action==='assign' && value!=='me' && value!=='none') throw bad(400,'Atribuição inválida.');
      const item=await update('solicitacoes.json',list=>{
        const x=list.find(x=>x.id===stateMatch[1]);if(!x||!inCompany(user,x))throw bad(404,'Solicitação não encontrada.');
        if(action==='status') x.status=value;
        if(action==='priority') x.priority=value;
        if(action==='assign') x.assignedTo=value==='me'?user.name:null;
        x.updatedAt=new Date().toISOString();return stripRequest(x,user.role);
      });await audit('solicitacao_'+action,user.username,`${item.id}: ${value}`);return json(res,200,{item});
    }
    const wppAction=pathname.match(/^\/api\/staff\/whatsapp\/([a-f0-9-]{36})\/(assumir|devolver|mensagens)$/);
    if(wppAction && req.method==='POST') {
      const user=allow(s,['atendimento','admin']);requireCompany(user);
      if(!WPP) throw bad(503,'WhatsApp não configurado.');
      const [,id,action]=wppAction;
      if(action==='mensagens') {
        const texto=str(input.texto,1000);
        if(!texto) throw bad(400,'Escreva a mensagem.');
        const c=(await conversas.listar()).find(x=>x.id===id);
        if(!c||!inCompany(user,c)) throw bad(404,'Conversa não encontrada.');
        if(c.modo!=='humano') throw bad(409,'Assuma a conversa antes de responder.');
        if(!conversas.janelaAberta(c)) throw bad(409,'Passaram 24 horas desde a última mensagem do cliente. A Meta só permite responder com um modelo aprovado.');
        try { await whatsapp.graphSend(WPP,c.telefone,texto); }
        catch(err) { console.error('WhatsApp: falha ao enviar para',whatsapp.mask(c.telefone)+':',err.message); throw bad(502,'Não foi possível enviar pelo WhatsApp. Tente novamente.'); }
        await conversas.registrarSaida({to:c.telefone,texto,de:'atendente',autor:user.name});
        await audit('whatsapp_resposta',user.username,id);
      } else {
        await conversas.alterar(id,c=>{
          if(!c||!inCompany(user,c)) throw bad(404,'Conversa não encontrada.');
          if(action==='assumir') Object.assign(c,{modo:'humano',atendente:user.name,pedidoAtendente:false});
          else Object.assign(c,{modo:'robo',atendente:null});
        });
        await audit('whatsapp_'+action,user.username,id);
      }
      const c=(await conversas.listar()).find(x=>x.id===id);
      return json(res,200,{item:conversas.completa(c)});
    }
    // Administração exclusiva, independente de exibir / esconder botões no frontend.
    const admin=allow(s,['admin']);
    if(pathname==='/api/admin/security/unlock' && req.method==='POST') {
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin)) throw bad(401,'Senha administrativa incorreta.');
      const username=str(input.username,30).toLowerCase();
      if(!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad(400,'Conta inválida.');
      if(!(await read(auth.USERFILE)).some(u=>u.username===username)) throw bad(404,'Conta não encontrada.');
      const hadLock=auth.unblock(username);
      await audit('desbloqueio_manual',admin.username,`${username} • ${hadLock?'Bloqueio removido':'Conta já estava liberada'}`);
      await logLoginAttempt(username,'desbloqueio',`Desbloqueado pelo administrador ${admin.username}`);
      return json(res,200,{ok:true,unlocked:hadLock});
    }
    if(pathname==='/api/admin/companies' && req.method==='POST') {
      const admin=allow(s,['admin']);
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin))throw bad(401,'Confirme sua senha administrativa.');
      const name=str(input.name,100),contact=str(input.contact,120),notes=str(input.notes,500),region=companyRegion(input);
      if(name.length<3)throw bad(400,'Nome da empresa deve ter pelo menos 3 caracteres.');
      const company={id:crypto.randomUUID(),name,...region,contact,notes,state:'em_configuracao',subscription:{plan:'essencial',status:'teste',setupCents:49000,monthlyCents:19900,nextDueDate:null,updatedAt:new Date().toISOString(),paymentIntegration:false},createdAt:new Date().toISOString()};
      await update('empresas.json',list=>list.push(company));
      await audit('empresa_criada',admin.username,`${company.id}: ${company.name}`);
      return json(res,201,{item:company});
    }
    const companyMatch=pathname.match(/^\/api\/admin\/companies\/([a-f0-9-]{36})\/(details|subscription)$/);
    if(companyMatch && req.method==='PUT') {
      const admin=allow(s,['admin']);
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin))throw bad(401,'Confirme sua senha administrativa.');
      const action=companyMatch[2];
      const item=await update('empresas.json',list=>{
        const x=list.find(x=>x.id===companyMatch[1]);if(!x)throw bad(404,'Empresa não encontrada.');
        if(action==='details'){
          const name=str(input.name,100),state=str(input.state,30);
          if(name.length<3||!['em_configuracao','ativa','pausada'].includes(state))throw bad(400,'Dados da empresa inválidos.');
          Object.assign(x,{name,state,...companyRegion(input),contact:str(input.contact,120),notes:str(input.notes,500)});
        }else x.subscription=subscription(input);
        return x;
      });
      await audit('empresa_'+action,admin.username,`${item.id}: ${item.name}`);
      return json(res,200,{item});
    }
    if(pathname==='/api/admin/users') {
      const username=str(input.username,30).toLowerCase(),name=str(input.name,80),role=str(input.role,20);
      if(!/^[a-z0-9._-]{3,30}$/.test(username)||name.length<2||!['cliente','atendimento'].includes(role)) throw bad(400,'Crie apenas usuários de atendimento ou cliente vinculados a uma empresa.');
      const companyId=str(input.companyId,36);
      if(!await companyExists(companyId)) throw bad(400,'Selecione uma empresa cadastrada.');
      const password=auth.generatePassword();
      const user=await update(auth.USERFILE, list=>{
        if(list.some(x=>x.username===username)) throw bad(409,'Nome de usuário já utilizado.');
        const u={id:crypto.randomUUID(),username,name,role,companyId,active:true,mustChangePassword:true,createdAt:new Date().toISOString(),...auth.hashPassword(password)};
        list.push(u);return u;
      });await audit('usuario_criado',admin.username,`${username} (${role})`);
      return json(res,201,{user:auth.safeUser(user),temporaryPassword:password});
    }
    const userMatch=pathname.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/(status|reset|role)$/);
    if(userMatch) {
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin)) throw bad(401,'Confirme sua senha de administrador.');
      const action=userMatch[2],targetId=userMatch[1];
      const pw=action==='reset'?auth.generatePassword():null;
      const target=await update(auth.USERFILE,list=>{
        const u=list.find(x=>x.id===targetId);if(!u)throw bad(404,'Usuário não encontrado.');
        if(u.id===admin.id && action!=='reset') throw bad(400,'Você não pode alterar seu próprio perfil por esta função.');
        const activeAdmins=list.filter(x=>x.role==='admin'&&x.active).length;
        if(u.role==='admin'&&u.active&&activeAdmins===1&&((action==='status'&&input.active===false)||(action==='role'&&input.role!=='admin'))) throw bad(400,'Não é possível retirar o último administrador ativo.');
        if(action==='status') { if(typeof input.active!=='boolean')throw bad(400,'Status inválido.');u.active=input.active; }
        if(action==='role') { if(u.role==='admin'||!['cliente','atendimento'].includes(input.role))throw bad(400,'Somente atendimento e cliente podem ser alternados.');u.role=input.role; }
        if(action==='reset') Object.assign(u,auth.hashPassword(pw),{mustChangePassword:true});
        return auth.safeUser(u);
      });auth.revokeUser(targetId);if(action==='reset')auth.unblock(target.username);await audit('usuario_'+action,admin.username,target.username);
      return json(res,200,{user:target,...(pw?{temporaryPassword:pw}:{})});
    }
    const membershipMatch=pathname.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/company$/);
    if(membershipMatch && req.method==='PUT'){
      const admin=allow(s,['admin']);
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin))throw bad(401,'Confirme sua senha administrativa.');
      const companyId=str(input.companyId,36);
      if(!await companyExists(companyId))throw bad(400,'Empresa não cadastrada.');
      const target=await update(auth.USERFILE,users=>{
        const u=users.find(x=>x.id===membershipMatch[1]);if(!u)throw bad(404,'Usuário não encontrado.');
        if(u.role==='admin')throw bad(403,'Administradores gerais não pertencem a uma única empresa.');
        if(u.companyId===companyId)return auth.safeUser(u);
        return null; // verificação assíncrona de solicitações ocorre abaixo, fora do lock
      });
      if(target)return json(res,200,{user:target});
      const reqs=await read('solicitacoes.json');
      if(reqs.some(x=>x.ownerId===membershipMatch[1]))throw bad(409,'Este cliente já possui solicitações. Não é seguro movê-lo para outra empresa.');
      const changed=await update(auth.USERFILE,users=>{
        const u=users.find(x=>x.id===membershipMatch[1]);if(!u||u.role==='admin')throw bad(404,'Conta não encontrada.');
        u.companyId=companyId;return auth.safeUser(u);
      });auth.revokeUser(changed.id);await audit('usuario_empresa',admin.username,`${changed.username}: ${companyId}`);
      return json(res,200,{user:changed});
    }
    if(pathname==='/api/admin/config' && req.method==='PUT') {
      if(typeof input.currentPassword!=='string'||!auth.verifyPassword(input.currentPassword,admin)) throw bad(401,'Confirme sua senha.');
      const cfg={name:str(input.name,90),assistantName:str(input.assistantName,90),serviceArea:str(input.serviceArea,250),services:Array.isArray(input.services)?input.services.slice(0,20).map(s=>str(s,90)).filter(Boolean):[],policy:str(input.policy,700),contact:str(input.contact,400),welcome:str(input.welcome,700)};
      if(!cfg.name||!cfg.assistantName||!cfg.services.length)throw bad(400,'Informe nome, assistente e ao menos um serviço.');
      await fs.mkdir(DATA,{recursive:true});
      const target=path.join(DATA,'empresa.json'),temp=target+'.tmp';
      await fs.writeFile(temp,JSON.stringify(cfg,null,2),{mode:0o600});await fs.rename(temp,target);
      await audit('config_alterada',admin.username,'Dados da empresa');return json(res,200,{ok:true,config:cfg});
    }
    throw bad(404,'Rota não encontrada.');
  } catch(err) {
    if(!err.status) console.error('Erro interno:',err.message);
    if (!res.headersSent) errorResponse(req,res,err.status||500,err.status?err.message:'Erro interno. Consulte o terminal.');
    else res.end();
  }
});
let unlock=()=>{};
async function start() {
  const users=await read(auth.USERFILE);
  if(!Array.isArray(users)||users.length===0)throw Error('Nenhum usuario foi encontrado na pasta permanente. Execute PREPARAR-DADOS.bat e importe sua pasta data antiga antes de iniciar.');
  unlock=acquireServerLock();
  process.on('exit',()=>unlock());
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>process.exit(0)));
  await migrateLegacy();
  server.on('error',err=>{console.error('Falha ao iniciar:',err.message);unlock();process.exitCode=1;});
  server.listen(PORT,HOST,()=>{
  console.log('Diretorio de dados: '+DATA);
  console.log(`\nAtende.IA v0.3.8.3 — http://${HOST}:${PORT}`);
  console.log('Painel: /acesso | modo LOCAL, não publicar na internet.');
  console.log(AI_ENABLED?`IA: ${MODEL}`:'IA: demonstração programada.');
  console.log('Os usuarios sao preservados em uma pasta permanente.\n');
  });
  if (WPP) {
    // Mesmo processo (mesma fila de gravação), porta separada: o túnel só enxerga o webhook.
    const webhook=whatsapp.createWebhook(WPP,{conversas:{
      entrada:msg=>conversas.registrarEntrada(msg,WPP.companyId),
      saida:conversas.registrarSaida
    }});
    webhook.on('error',err=>{console.error('WhatsApp: falha ao abrir a porta',WPP.port+':',err.message);process.exitCode=1;});
    webhook.listen(WPP.port,whatsapp.HOST,()=>{
      console.log(`WhatsApp: webhook em http://${whatsapp.HOST}:${WPP.port}${whatsapp.ROUTE}`);
      console.log(`Aponte o túnel SOMENTE para a porta ${WPP.port}, nunca para a ${PORT}.`);
      if(!WPP.companyId) console.log('WhatsApp: sem WHATSAPP_EMPRESA_ID, só administradores veem as conversas.');
      if(!WPP.allowed.length) console.log('ATENÇÃO: sem WHATSAPP_ALLOWED_NUMBERS, qualquer número que escrever recebe resposta.');
    });
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>webhook.close());
  }
}
start().catch(error=>{console.error('Falha ao preparar dados:',error.message);unlock();process.exitCode=1;});
