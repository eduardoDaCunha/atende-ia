'use strict';
// Testa bloqueio entre instancias e persistencia entre versoes em sandbox isolado.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=path.resolve(__dirname,'..');
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'atende-update-safe-'));
 const base1=path.join(home,'versaoA'),base2=path.join(home,'versaoB'),data=path.join(home,'persistente');
 let first=null,second=null;
 const files=['server.js','store.js','auth.js','resposta.js','whatsapp.js','conversas.js','empresa.json'];
 async function copy(dest){await fs.mkdir(dest);for(const name of files)await fs.copyFile(path.join(root,name),path.join(dest,name));await fs.cp(path.join(root,'site'),path.join(dest,'site'),{recursive:true});}
 const launch=(base,port)=>{
  const proc=spawn(process.execPath,['server.js'],{cwd:base,env:{...process.env,ATENDE_DATA_DIR:data,PORT:String(port),TAILSCALE_HOST:'',GEMINI_API_KEY:''},stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
  return {proc,get output(){return output;}};
 };
 const healthy=async port=>{for(let i=0;i<55;i++){await wait(100);try{const r=await fetch('http://127.0.0.1:'+port+'/api/auth/me');if(r.status===200)return true;}catch{}}return false;};
 try{
  await copy(base1);await copy(base2);await fs.mkdir(data);
  // Bloquear inicio sem usuario em vez de criar um cadastro vazio.
  first=launch(base1,39031);await new Promise(resolve=>first.proc.on('close',resolve));
  assert.match(first.output,/Nenhum usuario foi encontrado/);
  const auth=require(path.join(base1,'auth.js'));
  const original={id:crypto.randomUUID(),username:'admin-teste',name:'Administrador de testes',role:'admin',active:true,mustChangePassword:false,createdAt:new Date().toISOString(),...auth.hashPassword('Senha-forte-para-teste!')};
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([original]));
  first=launch(base1,39032);assert.equal(await healthy(39032),true,first.output);
  second=launch(base2,39033);await new Promise(resolve=>second.proc.on('close',resolve));
  assert.match(second.output,/Outra versao do Atende.IA parece estar aberta/);
  assert.equal((await fs.readFile(path.join(data,'usuarios.json'),'utf8')).includes(original.hash),true);
  first.proc.kill('SIGTERM');await new Promise(resolve=>first.proc.once('close',resolve));first=null;
  second=launch(base2,39034);assert.equal(await healthy(39034),true,second.output);
  const users=JSON.parse(await fs.readFile(path.join(data,'usuarios.json'),'utf8'));
  assert.equal(users.length,1);assert.ok(auth.verifyPassword('Senha-forte-para-teste!',users[0]));
  console.log('OK: novo servidor usa cadastro persistente, trava duplicacao, preserva usuarios e bloqueia arranque vazio.');
 } finally {
  for(const child of [first,second])if(child&&child.proc.exitCode===null){child.proc.kill('SIGTERM');await new Promise(resolve=>child.proc.once('close',resolve));}
  await fs.rm(home,{recursive:true,force:true});
 }
})().catch(e=>{console.error('FALHA:',e);process.exitCode=1;});
