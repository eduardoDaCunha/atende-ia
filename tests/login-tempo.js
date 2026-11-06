'use strict';
// Login: scrypt assíncrono, no máximo 4 verificações ao mesmo tempo, e usuário inexistente
// gasta o mesmo tempo que senha errada (o tempo de resposta não revela quem existe).
// Cópia isolada e dados fictícios; nunca acessa a pasta permanente.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const mediana=v=>{const o=[...v].sort((a,b)=>a-b);return o[Math.floor(o.length/2)];};

async function testarModulo(){
  // Conta quantos scrypt rodam juntos, sem mudar o resultado.
  const original=crypto.scrypt;let ativos=0,pico=0;
  crypto.scrypt=(...args)=>{const cb=args.pop();ativos++;pico=Math.max(pico,ativos);original(...args,(err,buf)=>{ativos--;cb(err,buf);});};
  try{
    const auth=require(path.join(root,'auth.js'));
    assert.equal(typeof auth.verifyPasswordAsync,'function','verifyPasswordAsync existe');
    const user=auth.hashPassword('Senha-Ficticia-2026!');
    const pendente=auth.verifyPasswordAsync('Senha-Ficticia-2026!',user);
    assert.ok(pendente instanceof Promise,'Verificação é assíncrona');
    assert.equal(await pendente,true);
    assert.equal(await auth.verifyPasswordAsync('errada',user),false);
    assert.equal(await auth.verifyPasswordAsync('qualquer',{salt:'00',hash:'00'}),false,'Hash malformado não derruba o login');
    assert.equal(await auth.verifyPasswordAsync('qualquer',auth.HASH_FICTICIO),false,'Hash fictício nunca confere');
    pico=0;
    const resultados=await Promise.all(Array.from({length:12},(_,i)=>auth.verifyPasswordAsync(i%2?'errada':'Senha-Ficticia-2026!',user)));
    assert.deepEqual(resultados,Array.from({length:12},(_,i)=>!(i%2)));
    assert.ok(pico>=2&&pico<=4,`No máximo 4 verificações simultâneas (pico ${pico})`);
    // Fila limitada (4 rodando + 64 esperando): o excesso é recusado na hora com status 503.
    const lote=await Promise.allSettled(Array.from({length:100},()=>auth.verifyPasswordAsync('errada',user)));
    const recusadas=lote.filter(x=>x.status==='rejected');
    assert.equal(lote.length-recusadas.length,68,'4 rodando + 64 na fila são atendidas');
    assert.ok(recusadas.every(x=>x.reason.status===503&&x.reason.code==='fila_scrypt'),'Excesso recusado com 503');
    assert.equal(await auth.verifyPasswordAsync('Senha-Ficticia-2026!',user),true,'Fila vazia volta a atender');
  }finally{crypto.scrypt=original;}
}

async function testarServidor(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-login-'));
  let child;
  try{
    await require('./arquivos-servidor').copiar(root,base);
    await fs.mkdir(path.join(base,'data'));
    const {hashPassword}=require(path.join(base,'auth.js'));
    const usuarios=['ana.teste','bia.teste','caio.teste'].map(username=>({id:crypto.randomUUID(),username,name:username,role:'admin',companyId:null,active:true,mustChangePassword:false,createdAt:new Date().toISOString(),...hashPassword('Senha-Ficticia-2026!')}));
    await fs.writeFile(path.join(base,'data','usuarios.json'),JSON.stringify(usuarios));
    const port=37000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
    const env={...process.env,PORT:String(port),ATENDE_DATA_DIR:path.join(base,'data'),GEMINI_API_KEY:''};
    for(const key of Object.keys(env))if(key.startsWith('WHATSAPP_'))delete env[key];
    child=spawn(process.execPath,['server.js'],{cwd:base,env,stdio:'ignore'});
    for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,75));}
    async function tempo(username){
      const t=process.hrtime.bigint();
      const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password:'Senha-Errada-2026!'})});
      await r.text();assert.equal(r.status,401);
      return Number(process.hrtime.bigint()-t)/1e6;
    }
    const existe=[],naoExiste=[];
    // 4 tentativas por conta (o bloqueio é na 5ª), intercaladas com nomes que não existem.
    for(let rodada=0;rodada<4;rodada++)for(const u of usuarios){existe.push(await tempo(u.username));naoExiste.push(await tempo(`ninguem${rodada}.${u.username}`));}
    const a=mediana(existe),b=mediana(naoExiste);
    assert.ok(b>=a*0.6,`Usuário inexistente responde em tempo parecido (inexistente ${b.toFixed(1)} ms, existente ${a.toFixed(1)} ms)`);
  }finally{
    if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
}

(async()=>{
  await testarModulo();
  await testarServidor();
  console.log('OK: login com scrypt assíncrono, até 4 verificações simultâneas e mesmo tempo para usuário inexistente.');
})().catch(err=>{console.error(err);process.exitCode=1;});
