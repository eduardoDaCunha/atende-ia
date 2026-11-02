'use strict';
// Cópia isolada e dados fictícios; nunca acessa a pasta permanente.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-rate-'));
  let child;
  try {
    await require('./arquivos-servidor').copiar(root,base);
    await fs.mkdir(path.join(base,'data'));
    const users=JSON.stringify([{id:'test',username:'teste',role:'admin',active:true}]);
    await fs.writeFile(path.join(base,'data','usuarios.json'),users);
    const port=38000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
    const env={...process.env,PORT:String(port),ATENDE_DATA_DIR:path.join(base,'data'),GEMINI_API_KEY:''};
    for(const key of Object.keys(env))if(key.startsWith('WHATSAPP_'))delete env[key];
    child=spawn(process.execPath,['server.js'],{cwd:base,env,stdio:'ignore'});
    async function call(route,options){const r=await fetch(origin+route,options);await r.text();return r;}
    let ready=false;
    for(let i=0;i<80;i++){
      try{if((await call('/api/status')).status===200){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,75));
    }
    assert.ok(ready,'Servidor de teste iniciou');
    assert.equal((await call('/api/status',{method:'POST',body:'x'.repeat(16001)})).status,413);
    assert.equal((await call('/'+'x'.repeat(2050))).status,414);
    for(let i=0;i<40;i++)assert.equal((await call('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,400);
    const loginBlocked=await call('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(loginBlocked.status,429);
    assert.equal(loginBlocked.headers.get('retry-after'),'900');
    let blocked=0;
    for(let i=0;i<650;i++){
      const response=await call('/api/status',{headers:{'X-Forwarded-For':`198.51.100.${i%250}`}});
      assert.ok([200,429].includes(response.status));
      if(response.status===429){blocked++;assert.equal(response.headers.get('retry-after'),'60');}
    }
    assert.ok(blocked>=90,'GET limitado mesmo com IP encaminhado falsificado');
    assert.equal(await fs.readFile(path.join(base,'data','usuarios.json'),'utf8'),users);
    assert.deepEqual((await fs.readdir(path.join(base,'data'))).filter(n=>n.endsWith('.json')),['usuarios.json']);
    console.log('OK: GET, login, payload, URL e IP falsificado; nenhum cadastro ou log gravado pelo excesso.');
  }finally{
    if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    await fs.rm(base,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
