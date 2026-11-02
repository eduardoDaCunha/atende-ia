'use strict';
// Cidade -> UF: lista do IBGE íntegra, reconhecimento com erros de digitação, nomes em vários
// estados e arquivos servidos só para administradores. Usuários fictícios.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const C=require(path.join(root,'site','interno','cidades.js'));
const dados=require(path.join(root,'site','interno','municipios.json'));

(async()=>{
  // Lista do IBGE
  assert.equal(Object.keys(dados.ufs).length,27,'26 estados + DF');
  assert.ok(dados.total>=5560&&dados.total<=5600,'Cerca de 5.570 municípios');
  assert.equal(Object.values(dados.ufs).reduce((n,l)=>n+l.length,0),dados.total);
  assert.ok(dados.ufs.SC.includes('Florianópolis')&&dados.ufs.DF.includes('Brasília')&&dados.ufs.AM.includes('Manaus'));

  const c=C.criar(dados);
  const unica=(texto,nome,uf)=>{const r=c.reconhecer(texto);assert.equal(r.tipo,'unica',`${texto}: ${JSON.stringify(r)}`);assert.deepEqual(r.cidade,{nome,uf},texto);return r;};
  // Exatos, sem acento, maiúsculas
  assert.equal(unica('Florianópolis','Florianópolis','SC').corrigido,false);
  unica('florianopolis','Florianópolis','SC');unica('SAO PAULO','São Paulo','SP');unica('itajai','Itajaí','SC');unica('Brasilia','Brasília','DF');
  // Erros de digitação: letra trocada, faltando, sobrando e invertida
  for(const [t,n,u] of [['Floripanópolis','Florianópolis','SC'],['balneário camburiu','Balneário Camboriú','SC'],['porto alegri','Porto Alegre','RS'],
    ['joinvile','Joinville','SC'],['blumenal','Blumenau','SC'],['palhosa','Palhoça','SC'],['crciuma','Criciúma','SC'],['curitbia','Curitiba','PR']])
    assert.equal(unica(t,n,u).corrigido,true,t);
  // Apelidos, abreviações, apóstrofo e UF digitada junto
  unica('floripa','Florianópolis','SC');unica('Sampa','São Paulo','SP');unica('Sto Amaro','Santo Amaro','BA');
  unica("alta floresta doeste","Alta Floresta D'Oeste",'RO');unica('Bom Jesus - SC','Bom Jesus','SC');unica('bom jesus/rs','Bom Jesus','RS');
  // Começo de nome: único vira cidade; vários ficam só como sugestão
  unica('florianopoli','Florianópolis','SC');
  assert.equal(c.reconhecer('Floria').tipo,'nenhuma');
  assert.ok(c.buscar('Floria').some(x=>x.nome==='Florianópolis'),'Sugere enquanto digita');
  // Nome em vários estados: não chuta
  const bj=c.reconhecer('Bom Jesus');
  assert.equal(bj.tipo,'ambigua');assert.ok(bj.opcoes.length>=4&&bj.opcoes.every(o=>o.nome==='Bom Jesus'));
  // Nada parecido
  assert.equal(c.reconhecer('xyzqwk').tipo,'nenhuma');assert.equal(c.reconhecer('').tipo,'nenhuma');assert.equal(c.reconhecer('a').tipo,'nenhuma');
  assert.deepEqual(c.buscar('sp'),[],'Duas letras sem apelido: nada');
  // Rapidez: dentro do que a digitação aguenta
  const t0=performance.now();for(let i=0;i<20;i++)c.buscar('balneario camburiu');
  assert.ok((performance.now()-t0)/20<80,'Busca rápida o bastante para digitação');
  // Utilitários
  assert.equal(C.chave("São José d'Oeste"),'saojosedoeste');assert.equal(C.distancia('abcd','abdc',2),1,'Transposição custa 1');

  await arquivosSoParaAdmin();
  console.log('OK: cidade -> UF — lista do IBGE, erros de digitação, apelidos, nomes em vários estados e arquivos só para administradores.');
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});

async function arquivosSoParaAdmin(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-cidades-'));
  const data=path.join(base,'data');await fs.mkdir(data);
  for(const name of ['server.js','auth.js','store.js','resposta.js','whatsapp.js','conversas.js','empresa.json'])await fs.copyFile(path.join(root,name),path.join(base,name));
  await fs.cp(path.join(root,'site'),path.join(base,'site'),{recursive:true});
  const {hashPassword}=require(path.join(base,'auth.js'));
  const pw='Senha-Ficticia-2026!',empresa=crypto.randomUUID(),agora=new Date().toISOString();
  const u=(username,role,companyId)=>({id:crypto.randomUUID(),username,name:username,role,companyId,active:true,mustChangePassword:false,createdAt:agora,...hashPassword(pw)});
  await fs.writeFile(path.join(data,'empresas.json'),JSON.stringify([{id:empresa,name:'Empresa Fictícia',city:'Florianópolis',uf:'SC',timeZone:'America/Sao_Paulo',state:'ativa',createdAt:agora}]));
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([u('admin.teste','admin',null),u('ana.teste','atendimento',empresa)]));
  const port=39000+Math.floor(Math.random()*900),origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['server.js'],{cwd:base,stdio:'ignore',env:{...process.env,ATENDE_DATA_DIR:data,PORT:String(port),GEMINI_API_KEY:'',TAILSCALE_HOST:'',WHATSAPP_TOKEN:'',WHATSAPP_APP_SECRET:'',WHATSAPP_VERIFY_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''}});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const get=(rota,cookie)=>fetch(origin+rota,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
  const login=async n=>{const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:n,password:pw})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  try{
    for(let i=0;i<80;i++){try{if((await get('/api/status')).status===200)break;}catch{}await wait(100);}
    const admin=await login('admin.teste'),ana=await login('ana.teste');
    for(const rota of ['/municipios.json','/cidades.js']){
      assert.equal((await get(rota)).status,302,`${rota} sem login`);
      assert.equal((await get(rota,ana)).status,302,`${rota} para atendimento`);
      const r=await get(rota,admin);assert.equal(r.status,200,`${rota} para admin`);
    }
    const lista=await (await get('/municipios.json',admin)).json();
    assert.equal(lista.total,dados.total);
    const html=await (await get('/admin',admin)).text();
    assert.ok(html.indexOf('/cidades.js')>0&&html.indexOf('/cidades.js')<html.indexOf('/empresas.js'),'cidades.js carrega antes de empresas.js');
  }finally{
    server.kill();await wait(300);await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
}
