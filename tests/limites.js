'use strict';
// Limites de requisição: cotas globais separadas (site público, painel, login), tabela cheia
// descarta as chaves mais antigas em vez de recusar IPs novos, e IPv6 agrupado por /64.
// Os IPs dos visitantes são simulados com ATENDE_PROXY_CONFIAVEL=1 (o teste fala com 127.0.0.1).
// Cópia isolada e dados fictícios; nunca acessa a pasta permanente.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');

(async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-limites-'));
  let child;
  try{
    await require('./arquivos-servidor').copiar(root,base);
    await fs.mkdir(path.join(base,'data'));
    await fs.writeFile(path.join(base,'data','usuarios.json'),JSON.stringify([{id:crypto.randomUUID(),username:'teste',name:'Teste',role:'admin',active:true,mustChangePassword:false,hash:'00',salt:'00'}]));
    const port=36000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
    const env={...process.env,PORT:String(port),ATENDE_DATA_DIR:path.join(base,'data'),GEMINI_API_KEY:'',ATENDE_PROXY_CONFIAVEL:'1',ATENDE_LIMITE_CHAVES:'64'};
    for(const key of Object.keys(env))if(key.startsWith('WHATSAPP_'))delete env[key];
    child=spawn(process.execPath,['server.js'],{cwd:base,env,stdio:'ignore'});
    const get=async(rota,ip)=>{const r=await fetch(origin+rota,{headers:{'X-Forwarded-For':ip}});await r.text();return r.status;};
    const login=async ip=>{const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':ip},body:'{}'});await r.text();return r.status;};
    let pronto=false;
    for(let i=0;i<80;i++){try{if((await get('/api/status','192.0.2.250'))===200){pronto=true;break;}}catch{}await new Promise(r=>setTimeout(r,75));}
    assert.ok(pronto,'Servidor de teste iniciou');

    // IPv6: endereços do mesmo /64 dividem o limite de login (40 em 15 min); outro /64 não é afetado.
    for(let i=1;i<=40;i++)assert.equal(await login(`2001:db8:1:2::${i.toString(16)}`),400);
    assert.equal(await login('2001:db8:1:2:ffff:ffff:ffff:ffff'),429,'Mesmo /64 conta junto');
    assert.equal(await login('2001:0db8:0001:0002:0:0:0:abcd'),429,'Mesmo /64 escrito por extenso');
    assert.equal(await login('2001:db8:1:3::1'),400,'Outro /64 tem a própria cota');
    assert.equal(await login('::ffff:192.0.2.7'),400,'IPv4 mapeado em IPv6 é tratado como IPv4');

    // Tabela cheia (64 chaves no teste): IPs novos continuam sendo atendidos.
    for(let i=1;i<=150;i++)assert.equal(await get('/api/auth/me',`203.0.113.${i}`),200,`IP novo ${i} atendido com a tabela cheia`);
    // Tabela cheia descarta primeiro as chaves não bloqueadas: o /64 barrado no login continua barrado.
    assert.equal(await login('2001:db8:1:2::99'),429,'Bloqueio ativo sobrevive à tabela cheia');

    // Limite por IP antes da cota global: um IP insistindo no login não gasta a cota de login de todos.
    for(let lote=0;lote<320;lote+=20)await Promise.all(Array.from({length:20},()=>login('192.0.2.200')));
    assert.equal(await login('192.0.2.200'),429,'IP insistente barrado');
    assert.equal(await login('192.0.2.201'),400,'Outro IP ainda consegue tentar entrar');

    // Demonstração tem cota global própria (120/min), separada da cota do site público.
    const demo=async ip=>{const r=await fetch(origin+'/api/chat-demo',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify({message:'Oi'})});await r.text();return r.status;};
    for(let lote=0;lote<130;lote+=10)await Promise.all(Array.from({length:10},(_,j)=>demo(`198.18.0.${lote/10+1}`).then(s=>assert.ok([200,429].includes(s)))));
    assert.equal(await demo('198.18.1.1'),429,'Cota global da demonstração esgotada');
    assert.equal(await get('/api/status','198.18.1.2'),200,'Site público segue com a própria cota');

    // Site público esgotado (1200/min) por 5 IPs: login e painel seguem com cota própria.
    for(let lote=0;lote<1250;lote+=25)await Promise.all(Array.from({length:25},(_,j)=>get('/api/status',`198.51.100.${(lote+j)%5+1}`)));
    assert.equal(await get('/api/status','192.0.2.10'),429,'Cota global do site público esgotada');
    assert.equal(await get('/','192.0.2.11'),429,'Página pública também usa a cota do site');
    assert.equal(await login('192.0.2.12'),400,'Login tem cota própria');
    assert.equal(await get('/api/auth/me','192.0.2.13'),200,'Painel tem cota própria');
    assert.equal(await get('/api/staff/stats','192.0.2.14'),401,'API interna usa a cota do painel (pede login, não 429)');
    console.log('OK: cotas separadas para site público, demonstração, painel e login; limite por IP antes da cota global; tabela cheia mantém os bloqueios; IPv6 agrupado por /64.');
  }finally{
    if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
