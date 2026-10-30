'use strict';
// Simula os cabeçalhos de Host e Origin que o navegador transmite ao usar
// o endereço HTTPS Tailscale Serve. Não exige rede externa nem conta real.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const src=path.resolve(__dirname,'..');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'atende-serve-'));
 const dir=path.join(temp,'app'); await fs.mkdir(dir);
 for(const file of ['server.js','auth.js','store.js','resposta.js','empresa.json']) await fs.copyFile(path.join(src,file),path.join(dir,file));
 await fs.cp(path.join(src,'site'),path.join(dir,'site'),{recursive:true});
 const port=33000+Math.floor(Math.random()*2000);
 const tail='maquina-teste.tailnet-exemplo.ts.net';
 const hostLocal=`127.0.0.1:${port}`;
 const origin=`https://${tail}`;
 const req=(endpoint,{method='GET',host=tail,originHeader,accept='text/html',payload,cookie,csrf}={})=>new Promise((resolve,reject)=>{
   const headers={Host:host,Accept:accept};
   if(originHeader)headers.Origin=originHeader;
   if(cookie)headers.Cookie=cookie;
   if(csrf)headers['X-CSRF-Token']=csrf;
   if(payload!==undefined)headers['Content-Type']='application/json';
   const r=http.request({hostname:'127.0.0.1',port,path:endpoint,method,headers},response=>{
     const chunks=[];response.on('data',x=>chunks.push(x));response.on('end',()=>{
       const data=Buffer.concat(chunks).toString('utf8');
       let json;try{json=JSON.parse(data)}catch{}
       resolve({status:response.statusCode,type:response.headers['content-type'],location:response.headers.location,body:data,json,cookie:(response.headers['set-cookie']||[])[0]?.split(';')[0]});
     });
   });
   r.on('error',reject);
   if(payload!==undefined)r.write(JSON.stringify(payload));
   r.end();
 });
 let child;
 try{
   await fs.mkdir(path.join(dir,'data'));
   const admin={id:crypto.randomUUID(),username:'admin-teste',name:'Admin Teste',active:true,role:'admin',mustChangePassword:false,createdAt:new Date().toISOString(),...require(path.join(dir,'auth.js')).hashPassword('Senha-Forte-Teste-2026!')};
   await fs.writeFile(path.join(dir,'data','usuarios.json'),JSON.stringify([admin]));
   child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,ATENDE_DATA_DIR:path.join(dir,'data'),PORT:String(port),TAILSCALE_HOST:tail,GEMINI_API_KEY:''},stdio:'pipe'});
   let ready=false;
   for(let i=0;i<100;i++){
     if(child.exitCode!==null)break;
     try{if((await req('/api/status',{host:hostLocal,accept:'application/json'})).status===200){ready=true;break;}}catch{}
     await new Promise(r=>setTimeout(r,60));
   }
   assert.ok(ready,'Servidor não iniciou');
   const landing=await req('/');
   assert.equal(landing.status,200,'Site público pelo host Tailscale');
   assert.match(landing.type,/text\/html/,'Navegação deve retornar HTML');
   assert.match(landing.body,/Atende\.IA/);
   assert.equal((await req('/acesso')).status,200,'Login acessível via Tailscale');
   assert.equal((await req('/',{host:tail+':443'})).status,200,'Host com porta HTTPS também permitido');
   assert.equal((await req('/',{host:hostLocal})).status,200,'Localhost continua funcionando');
   const unauthorized=await req('/',{host:'outro.tailnet-exemplo.ts.net'});
   assert.equal(unauthorized.status,403,'Não aceitar outros hosts Tailscale');
   assert.match(unauthorized.type,/text\/html/,'Safari deve receber HTML, não download JSON');
   assert.ok(!unauthorized.body.startsWith('{'), 'A navegação não devolve JSON para Safari');
   assert.equal((await req('/',{host:'evil.example',accept:'application/json'})).json.error,'Endereço de acesso não permitido.','APIs/requests de dados continuam em JSON');
   const login=await req('/api/auth/login',{method:'POST',host:tail,originHeader:origin,accept:'application/json',payload:{username:'admin-teste',password:'Senha-Forte-Teste-2026!'}});
   assert.equal(login.status,200,JSON.stringify(login.json));
   assert.ok(login.cookie&&login.json.csrf,'Sessão e CSRF válidos');
   assert.equal((await req('/admin',{cookie:login.cookie})).status,200,'Admin autenticado pode abrir painel via Tailscale');
   assert.equal((await req('/admin')).status,302,'Admin não acessível sem login');
   const chat=await req('/api/chat',{method:'POST',originHeader:origin,accept:'application/json',payload:{message:'Oi'}});
   assert.equal(chat.status,200,'Chat disponível com Origin HTTPS do Tailscale');
   assert.ok(chat.json.answer,'Chat respondeu');
   const blocked=await req('/api/chat',{method:'POST',originHeader:'https://evil.example',accept:'application/json',payload:{message:'Oi'}});
   assert.equal(blocked.status,403,'Origem não autorizada é bloqueada');
   const noOrigin=await req('/api/auth/logout',{method:'POST',accept:'application/json',payload:{},cookie:login.cookie,csrf:login.json.csrf});
   assert.equal(noOrigin.status,403,'Sem Origin o logout é rejeitado');
   const logout=await req('/api/auth/logout',{method:'POST',originHeader:origin,accept:'application/json',payload:{},cookie:login.cookie,csrf:login.json.csrf});
   assert.equal(logout.status,200,'Logout via Tailscale funcionando');
   assert.equal((await req('/admin',{cookie:login.cookie})).status,302,'Sessão revogada após logout');
   console.log('OK: acesso Tailscale, Site, Login, Cookie, Chat, CSRF, Isolamento e erros HTML.');
 } finally {child?.kill();await fs.rm(temp,{recursive:true,force:true});}
})().catch(err=>{console.error('FALHA:',err);process.exitCode=1;});
