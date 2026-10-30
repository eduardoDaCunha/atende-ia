'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const interactive=(project,file,steps,env)=>new Promise((resolve,reject)=>{
 const c=spawn(process.execPath,[file],{cwd:project,env,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',idx=0;
 const clock=setTimeout(()=>{c.kill();reject(Error('Tempo esgotado: '+file+'\n'+stdout+'\n'+stderr));},12000);
 c.stdout.on('data',chunk=>{stdout+=chunk.toString();if(idx<steps.length&&stdout.includes(steps[idx][0])){c.stdin.write(steps[idx++][1]+'\n');}});
 c.stderr.on('data',chunk=>{stderr+=chunk.toString();});
 c.on('close',code=>{clearTimeout(clock);resolve({status:code,stdout,stderr});});
 c.on('error',reject);
});
(async()=>{
 const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'atende-persist-'));
 try{
   const src=path.resolve(__dirname,'..');
   const p1=path.join(tmp,'versao1');
   const p2=path.join(tmp,'versao2');
   const permanent=path.join(tmp,'permanente','data');
   await fsp.mkdir(path.join(p1,'data'),{recursive:true});
   await fsp.mkdir(p2);
   for(const file of ['auth.js','store.js','preparar-dados.js','recuperar-admin.js']){
     await fsp.copyFile(path.join(src,file),path.join(p1,file));
     await fsp.copyFile(path.join(src,file),path.join(p2,file));
   }
   const auth1=require(path.join(p1,'auth.js'));
   const admin={id:crypto.randomUUID(),username:'admin.teste',name:'Admin Teste',role:'admin',active:true,mustChangePassword:false,createdAt:new Date().toISOString(),...auth1.hashPassword('Senha-Antiga-2026!')};
   const staff={id:crypto.randomUUID(),username:'atendimento',name:'Atendente',role:'atendimento',active:true,mustChangePassword:false,createdAt:new Date().toISOString(),...auth1.hashPassword('Senha-Equipe-2026!')};
   const users=[admin,staff];
   await fsp.writeFile(path.join(p1,'data','usuarios.json'),JSON.stringify(users));
   await fsp.writeFile(path.join(p1,'data','solicitacoes.json'),'[{"id":"teste"}]');
   const env={...process.env,ATENDE_DATA_DIR:permanent};
   const cmd=(project,file,input)=>spawnSync(process.execPath,[file],{cwd:project,env,input,encoding:'utf8',timeout:20000});
   let v=await interactive(p1,'preparar-dados.js', [['Digite IMPORTAR','IMPORTAR']],env);
   assert.equal(v.status,0,v.stderr+' '+v.stdout);
   assert.match(v.stdout,/Dados importados com sucesso/);
   assert.deepEqual(JSON.parse(await fsp.readFile(path.join(permanent,'usuarios.json'),'utf8')),users);
   assert.equal((await fsp.readFile(path.join(permanent,'solicitacoes.json'),'utf8')),'[{"id":"teste"}]');
   assert.ok(fs.existsSync(path.join(p1,'data','usuarios.json')),'dados originais continuam presentes');
   // Segunda importacao nao substitui a base ativa.
   v=cmd(p2,'preparar-dados.js','');
   assert.equal(v.status,0,v.stderr+' '+v.stdout);
   assert.match(v.stdout,/Cadastro permanente existente/);
   assert.equal((await fsp.readFile(path.join(permanent,'usuarios.json'),'utf8')).includes(admin.hash),true);
   // Recuperar admin offline sem apagar atendente e criar backup.
   v=await interactive(p2,'recuperar-admin.js', [['Nome exato','admin.teste'],['Digite RECUPERAR','RECUPERAR']],env);
   assert.equal(v.status,0,v.stderr+' '+v.stdout);
   const matched=v.stdout.match(/SENHA PROVISORIA: ([A-Za-z0-9_!\-]+)/);
   assert.ok(matched,'senha temporaria foi exibida');
   const newPw=matched[1];
   const recovered=JSON.parse(await fsp.readFile(path.join(permanent,'usuarios.json'),'utf8'));
   assert.equal(recovered.length,2);
   assert.equal(recovered[0].id,admin.id);
   assert.equal(recovered[1].hash,staff.hash);
   assert.equal(recovered[0].mustChangePassword,true);
   assert.ok(auth1.verifyPassword(newPw,recovered[0]));
   assert.ok(!auth1.verifyPassword('Senha-Antiga-2026!',recovered[0]));
   assert.ok((await fsp.readdir(path.join(permanent,'backups'))).length>0);
   // Outra versao abre exatamente o mesmo banco via caminho fixo.
   process.env.ATENDE_DATA_DIR=permanent;
   const store2=require(path.join(p2,'store.js'));
   assert.equal(store2.DATA,permanent);
   const fromNext=await store2.read('usuarios.json');
   assert.equal(fromNext[0].hash,recovered[0].hash);
   console.log('OK: migracao conservadora, dados permanentes entre versoes, recuperacao do admin, backup e preservacao de outros usuarios.');
 }finally{await fsp.rm(tmp,{recursive:true,force:true});}
})().catch(err=>{console.error('FALHA:',err);process.exitCode=1;});
