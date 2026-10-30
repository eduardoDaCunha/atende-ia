'use strict';
// Diagnóstico: estados, separação configurado x testado, ausência de segredos,
// nenhuma chamada externa sem pedido explícito e rota só para administradores.
// Tudo fictício: segredos inventados, Google/Meta simuladas por funções ou servidor local.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const segredo=n=>`${n}-${crypto.randomBytes(12).toString('hex')}`;
const ENV_COMPLETO={
  PORT:'3999',GEMINI_API_KEY:segredo('AIzaFicticia'),GEMINI_MODEL:'gemini-teste',TAILSCALE_HOST:'maquina-ficticia.tailnet-ficticia.ts.net',
  WHATSAPP_VERIFY_TOKEN:segredo('verificacao'),WHATSAPP_APP_SECRET:segredo('appsecret'),WHATSAPP_TOKEN:segredo('EAAficticio'),
  WHATSAPP_PHONE_NUMBER_ID:'100000000000777',WHATSAPP_EMPRESA_ID:crypto.randomUUID(),WHATSAPP_PORT:'3998',
  WHATSAPP_ALLOWED_NUMBERS:'5548999990001,5548999990002',
  SECURITY_WHATSAPP_ENABLED:'1',SECURITY_WHATSAPP_TO:'5548999990009',SECURITY_WHATSAPP_TEMPLATE:'aviso_seguranca',SECURITY_WHATSAPP_LANGUAGE:'pt_BR',
};
const proibidos=env=>[env.GEMINI_API_KEY,env.WHATSAPP_VERIFY_TOKEN,env.WHATSAPP_APP_SECRET,env.WHATSAPP_TOKEN,env.WHATSAPP_PHONE_NUMBER_ID,env.WHATSAPP_EMPRESA_ID,
  env.SECURITY_WHATSAPP_TO,env.TAILSCALE_HOST,'5548999990001','5548999990002',os.homedir()].filter(Boolean);
const semVazamento=(relatorio,env,rotulo)=>{
  const json=JSON.stringify(relatorio);
  for(const v of proibidos(env))assert.equal(json.includes(v)||json.includes(JSON.stringify(v).slice(1,-1)),false,`${rotulo}: vazou ${v.slice(0,6)}...`);
};
const achar=(r,id)=>r.itens.find(i=>i.id===id);

/** fetch falso: registra chamadas e responde por padrão de URL. */
function fetchFalso(regras){
  const chamadas=[];
  const fn=async(url,init={})=>{
    chamadas.push({url:String(url),method:init.method||'GET',headers:init.headers||{}});
    for(const [padrao,resposta] of regras) if(padrao.test(String(url))){
      if(resposta instanceof Error) throw resposta;
      return new Response(JSON.stringify(resposta.corpo||{}),{status:resposta.status});
    }
    throw new Error('ECONNREFUSED');
  };
  fn.chamadas=chamadas;return fn;
}

(async()=>{
  const dataTemp=await fs.mkdtemp(path.join(os.tmpdir(),'atende-diag-'));
  process.env.ATENDE_DATA_DIR=dataTemp; // a checagem de pasta usa uma pasta temporária, não a real
  const {coletarDiagnostico,formatarTexto,VERSAO}=require(path.join(root,'diagnostico.js'));
  try{
    // 1. Nada configurado: demonstração, WhatsApp e alertas desligados, só 127.0.0.1 consultado.
    let f=fetchFalso([[/127\.0\.0\.1:3011\/api\/status/,{status:200,corpo:{version:VERSAO}}]]);
    let r=await coletarDiagnostico({env:{},fetch:f});
    assert.equal(achar(r,'servidor.disponibilidade').estado,'ok');
    assert.equal(achar(r,'servidor.disponibilidade').conexao,'testada_ok');
    assert.equal(achar(r,'ia.modo').configurado,false);
    assert.match(achar(r,'ia.modo').detalhe,/demonstração/);
    assert.equal(achar(r,'whatsapp.config').detalhe,'Desativado.');
    assert.equal(achar(r,'seguranca.alertas').configurado,false);
    assert.ok(f.chamadas.every(c=>c.url.startsWith('http://127.0.0.1:')),'Sem pedido explícito, só endereços locais');
    assert.equal(r.conexoesExternasTestadas,false);
    assert.equal(r.esquema,1);

    // 2. Servidor desligado ou com outra versão.
    r=await coletarDiagnostico({env:{},fetch:fetchFalso([])});
    assert.equal(achar(r,'servidor.disponibilidade').conexao,'testada_falha');
    assert.equal(r.resumo.geral,'falha');
    r=await coletarDiagnostico({env:{},fetch:fetchFalso([[/api\/status/,{status:200,corpo:{version:'9.9.9'}}]])});
    assert.equal(achar(r,'servidor.disponibilidade').estado,'aviso');

    // 3. Tudo configurado, sem testar conexões: configurado, mas "não testada", e nada vaza.
    f=fetchFalso([[/:3999\/api\/status/,{status:200,corpo:{version:VERSAO}}],[/:3998\/webhook\/whatsapp$/,{status:403}]]);
    r=await coletarDiagnostico({env:ENV_COMPLETO,fetch:f});
    const ia=achar(r,'ia.modo'),meta=achar(r,'whatsapp.meta'),alertas=achar(r,'seguranca.alertas');
    assert.equal(ia.configurado,true);assert.equal(ia.conexao,'nao_testada');
    assert.equal(achar(r,'whatsapp.config').configurado,true);
    assert.equal(achar(r,'whatsapp.webhook').conexao,'testada_ok','Webhook local testado (403 sem token)');
    assert.equal(meta.conexao,'nao_testada');
    assert.equal(alertas.configurado,true);assert.equal(alertas.conexao,'nao_testada');
    assert.match(alertas.detalhe,/exigiria enviar uma mensagem/);
    assert.equal(achar(r,'servidor.tailscale').configurado,true);
    assert.match(achar(r,'whatsapp.numeros').detalhe,/2 número/);
    assert.ok(f.chamadas.every(c=>c.url.startsWith('http://127.0.0.1:')&&c.method==='GET'));
    semVazamento(r,ENV_COMPLETO,'configurado');
    semVazamento({t:formatarTexto(r)},ENV_COMPLETO,'texto');

    // 4. Testar conexões: só GET de leitura, nunca /messages; sucesso e recusa.
    f=fetchFalso([[/:3999\/api\/status/,{status:200,corpo:{version:VERSAO}}],[/:3998\/webhook/,{status:403}],
      [/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-teste$/,{status:200,corpo:{name:'models/gemini-teste'}}],
      [/graph\.facebook\.com\/v25\.0\/100000000000777\?fields=id$/,{status:200,corpo:{id:'100000000000777',display_phone_number:'+55 48 99999-0001'}}]]);
    r=await coletarDiagnostico({env:ENV_COMPLETO,fetch:f,testarConexoes:true});
    assert.equal(achar(r,'ia.modo').conexao,'testada_ok');
    assert.equal(achar(r,'whatsapp.meta').conexao,'testada_ok');
    assert.equal(achar(r,'seguranca.alertas').conexao,'nao_testada','Alertas nunca são testados');
    assert.ok(f.chamadas.every(c=>c.method==='GET'&&!/\/messages/.test(c.url)),'Nenhum envio de mensagem');
    assert.equal(f.chamadas.filter(c=>!c.url.startsWith('http://127.0.0.1')).length,2,'Exatamente 2 consultas externas');
    semVazamento(r,ENV_COMPLETO,'conexões testadas');
    f=fetchFalso([[/api\/status/,{status:200,corpo:{version:VERSAO}}],[/:3998\/webhook/,{status:403}],[/googleapis/,{status:403}],[/graph\.facebook/,{status:401}]]);
    r=await coletarDiagnostico({env:ENV_COMPLETO,fetch:f,testarConexoes:true});
    assert.equal(achar(r,'ia.modo').conexao,'testada_falha');assert.match(achar(r,'ia.modo').detalhe,/chave recusada/);
    assert.equal(achar(r,'whatsapp.meta').conexao,'testada_falha');assert.match(achar(r,'whatsapp.meta').detalhe,/token/);
    f=fetchFalso([[/api\/status/,{status:200,corpo:{version:VERSAO}}],[/googleapis/,new Error('rede')],[/graph\.facebook/,new Error('rede')]]);
    r=await coletarDiagnostico({env:ENV_COMPLETO,fetch:f,testarConexoes:true});
    assert.equal(achar(r,'whatsapp.webhook').estado,'falha','Webhook local desligado');
    assert.equal(achar(r,'ia.modo').conexao,'testada_falha');

    // 5. Configurações incompletas viram falha com nomes de variáveis, nunca valores.
    r=await coletarDiagnostico({env:{WHATSAPP_TOKEN:ENV_COMPLETO.WHATSAPP_TOKEN},fetch:fetchFalso([])});
    assert.equal(achar(r,'whatsapp.config').estado,'falha');assert.match(achar(r,'whatsapp.config').detalhe,/WHATSAPP_APP_SECRET/);
    semVazamento(r,ENV_COMPLETO,'incompleto');
    r=await coletarDiagnostico({env:{SECURITY_WHATSAPP_ENABLED:'1',SECURITY_WHATSAPP_TO:'123'},fetch:fetchFalso([])});
    assert.equal(achar(r,'seguranca.alertas').estado,'falha');assert.match(achar(r,'seguranca.alertas').detalhe,/SECURITY_WHATSAPP_TO/);
    r=await coletarDiagnostico({env:{TAILSCALE_HOST:'https://errado'},fetch:fetchFalso([])});
    assert.equal(achar(r,'servidor.tailscale').estado,'falha');
    r=await coletarDiagnostico({env:{GEMINI_API_KEY:'curta'},fetch:fetchFalso([])});
    assert.equal(achar(r,'ia.modo').estado,'aviso');

    // 6. Linha de comando: JSON válido, sem segredos, e código de saída 1 com falha.
    const cli=spawnSync(process.execPath,[path.join(root,'diagnostico.js'),'--json'],{env:{...process.env,...ENV_COMPLETO,ATENDE_DATA_DIR:dataTemp},encoding:'utf8',timeout:30000});
    const doCli=JSON.parse(cli.stdout);
    assert.equal(doCli.versao,VERSAO);assert.equal(cli.status,1,'Servidor fora do ar => saída 1');
    semVazamento(doCli,ENV_COMPLETO,'CLI');

    await rotaDoServidor(dataTemp);
    console.log('OK: diagnóstico somente leitura — estados, configurado x testado, sem segredos, sem chamadas externas sem pedido, CLI e rota só para admin.');
  }finally{
    await fs.rm(dataTemp,{recursive:true,force:true}).catch(()=>{});
  }
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});

/** Rota /api/admin/diagnostico num servidor real com usuários fictícios e Graph falsa local. */
async function rotaDoServidor(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-diag-srv-'));
  const data=path.join(base,'data');await fs.mkdir(data);
  for(const name of ['server.js','auth.js','store.js','resposta.js','whatsapp.js','conversas.js','diagnostico.js','empresa.json'])await fs.copyFile(path.join(root,name),path.join(base,name));
  await fs.cp(path.join(root,'site'),path.join(base,'site'),{recursive:true});
  const {hashPassword}=require(path.join(base,'auth.js'));
  const pw='Senha-Ficticia-2026!',agora=new Date().toISOString(),empresa=crypto.randomUUID();
  await fs.writeFile(path.join(data,'empresas.json'),JSON.stringify([{id:empresa,name:'Empresa Fictícia',city:'Florianópolis',uf:'SC',timeZone:'America/Sao_Paulo',state:'ativa',createdAt:agora}]));
  const u=(username,role,companyId)=>({id:crypto.randomUUID(),username,name:username,role,companyId,active:true,mustChangePassword:false,createdAt:agora,...hashPassword(pw)});
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([u('admin.teste','admin',null),u('ana.teste','atendimento',empresa)]));

  const pedidosGraph=[];
  const graph=http.createServer((req,res)=>{pedidosGraph.push({method:req.method,url:req.url});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"id":"100000000000777"}');});
  await new Promise(r=>graph.listen(0,'127.0.0.1',r));
  const port=36000+Math.floor(Math.random()*1000),wport=port+1000,origin=`http://127.0.0.1:${port}`;
  const env={...ENV_COMPLETO,GEMINI_API_KEY:'',TAILSCALE_HOST:'',PORT:String(port),WHATSAPP_PORT:String(wport),
    WHATSAPP_GRAPH_BASE:`http://127.0.0.1:${graph.address().port}`,WHATSAPP_EMPRESA_ID:empresa};
  let saida='';
  const server=spawn(process.execPath,['server.js'],{cwd:base,stdio:'pipe',env:{...process.env,...env,ATENDE_DATA_DIR:data}});
  server.stdout.on('data',d=>saida+=d);server.stderr.on('data',d=>saida+=d);
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const call=async(route,method='GET',body=null,s=null,csrf=true)=>{
    const headers={Origin:origin};if(s){headers.Cookie=s.cookie;if(csrf)headers['X-CSRF-Token']=s.csrf;}
    if(body!==null)headers['Content-Type']='application/json';
    const r=await fetch(origin+route,{method,headers,body:body!==null?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    for(let i=0;i<80;i++){try{if((await call('/api/status')).status===200)break;}catch{}await wait(100);}
    const login=async n=>{const r=await call('/api/auth/login','POST',{username:n,password:pw});assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf};};
    const admin=await login('admin.teste'),ana=await login('ana.teste');

    assert.equal((await call('/api/admin/diagnostico')).status,401,'Sem login: recusado');
    assert.equal((await call('/api/admin/diagnostico','GET',null,ana)).status,403,'Atendimento: recusado');
    let r=await call('/api/admin/diagnostico','GET',null,admin);
    assert.equal(r.status,200);
    const rel=r.data;
    assert.equal(achar(rel,'servidor.disponibilidade').conexao,'testada_ok');
    assert.equal(achar(rel,'whatsapp.webhook').conexao,'testada_ok','Webhook real do servidor responde 403 sem token');
    assert.equal(achar(rel,'whatsapp.meta').conexao,'nao_testada');
    assert.equal(pedidosGraph.length,0,'GET não consulta a Meta');
    semVazamento(rel,env,'rota GET');
    assert.equal(JSON.stringify(rel).includes(data),false,'Caminho da pasta de dados não aparece');

    assert.equal((await call('/api/admin/diagnostico','POST',{testarConexoes:true},admin,false)).status,403,'Teste de conexões exige CSRF');
    assert.equal((await call('/api/admin/diagnostico','POST',{testarConexoes:true},ana)).status,403,'Atendimento não testa conexões');
    r=await call('/api/admin/diagnostico','POST',{testarConexoes:true},admin);
    assert.equal(r.status,200);
    assert.equal(achar(r.data,'whatsapp.meta').conexao,'testada_ok');
    assert.deepEqual(pedidosGraph.map(p=>p.method),['GET'],'Uma única leitura na Meta');
    assert.equal(pedidosGraph.some(p=>/messages/.test(p.url)),false,'Nenhuma mensagem enviada');
    semVazamento(r.data,env,'rota POST');
    for(let i=0;i<4;i++)await call('/api/admin/diagnostico','POST',{testarConexoes:true},admin);
    assert.equal((await call('/api/admin/diagnostico','POST',{testarConexoes:true},admin)).status,429,'Limite de testes por minuto');
    const auditoria=(await call('/api/admin/audit','GET',null,admin)).data.items.map(x=>x.action);
    assert.ok(auditoria.includes('diagnostico_conexoes'),'Teste de conexões fica na auditoria');
    // O servidor sempre mostrou a pasta de dados ao iniciar, no terminal local; o que não pode aparecer são segredos.
    for(const v of proibidos(env).filter(v=>v!==os.homedir()))assert.equal(saida.includes(v),false,'Terminal sem segredos');
  }finally{
    server.kill();graph.close();await wait(300);await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
}
