'use strict';
// Ferramentas de leitura do negócio: separação por empresa, máscaras, paginação, conteúdo
// só para administrador e política de dados pessoais no MCP. Dados 100% fictícios.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
process.env.ATENDE_DATA_DIR=fsSync.mkdtempSync(path.join(os.tmpdir(),'atende-neg-vazio-'));
const {criarCatalogo}=require(path.join(root,'catalogo.js'));
const {criarServidorMcp}=require(path.join(root,'mcp.js'));
const {iniciais,mascararTelefone}=require(path.join(root,'negocio.js'));

const A=crypto.randomUUID(),B=crypto.randomUUID();
const agora=Date.now(),iso=ms=>new Date(ms).toISOString();
const msg=(author,role,content,internal=false,ms=agora)=>({id:crypto.randomUUID(),author,role,content,internal,createdAt:iso(ms)});
const sol=(companyId,customerName,subject,status,ms,messages)=>({id:crypto.randomUUID(),companyId,ownerId:crypto.randomUUID(),customerName,subject,
  description:'Descrição privada de '+customerName,status,priority:'normal',assignedTo:null,createdAt:iso(ms),updatedAt:iso(ms),messages});
const DADOS={
  'empresas.json':[{id:A,name:'Empresa Fictícia A',city:'Florianópolis',uf:'SC',state:'ativa',contact:'contato-privado-a',notes:'observação-interna-a',subscription:{plan:'essencial',status:'teste'},createdAt:iso(agora-3000)},
                   {id:B,name:'Empresa Fictícia B',city:'Manaus',uf:'AM',state:'ativa',contact:'contato-privado-b',notes:'observação-interna-b',subscription:{plan:'profissional',status:'ativa'},createdAt:iso(agora-2000)}],
  'solicitacoes.json':[
    sol(A,'Maria Fictícia Souza','Pintura da sala','novo',agora-1000,[msg('Maria Fictícia Souza','cliente','texto-privado-1'),msg('Ana','atendimento','nota-interna-1',true)]),
    sol(A,'João Teste','Reforma do banheiro','em_andamento',agora-500,[msg('João Teste','cliente','texto-privado-2')]),
    sol(A,'Carla Exemplo','Orçamento cozinha','resolvido',agora-100,[]),
    sol(B,'Pedro Modelo','Revestimento','novo',agora-50,[msg('Pedro Modelo','cliente','texto-privado-b')]),
  ],
  'conversas-whatsapp.json':[
    {id:crypto.randomUUID(),telefone:'5548999990001',nome:'Maria Fictícia Souza',companyId:A,modo:'robo',atendente:null,pedidoAtendente:true,
     mensagens:[{id:'1',de:'cliente',autor:'Maria',texto:'wpp-privado-1',em:iso(agora-60_000)},{id:'2',de:'robo',autor:'Robô',texto:'wpp-robo-1',em:iso(agora-59_000)}],
     criadoEm:iso(agora-60_000),atualizadoEm:iso(agora-59_000),ultimaDoClienteEm:iso(agora-60_000)},
    {id:crypto.randomUUID(),telefone:'5548999990002',nome:'João Teste',companyId:A,modo:'humano',atendente:'Ana Atendente',pedidoAtendente:false,
     mensagens:[{id:'3',de:'cliente',autor:'João',texto:'wpp-privado-2',em:iso(agora-30*3600_000)}],criadoEm:iso(agora-30*3600_000),atualizadoEm:iso(agora-30*3600_000),ultimaDoClienteEm:iso(agora-30*3600_000)},
    {id:crypto.randomUUID(),telefone:'5511988880003',nome:'Pedro Modelo',companyId:B,modo:'robo',atendente:null,pedidoAtendente:false,
     mensagens:[{id:'4',de:'cliente',autor:'Pedro',texto:'wpp-privado-b',em:iso(agora-1000)}],criadoEm:iso(agora-1000),atualizadoEm:iso(agora-1000),ultimaDoClienteEm:iso(agora-1000)},
  ],
};
const ler=async nome=>structuredClone(DADOS[nome]||[]);
const PRIVADOS=['Maria Fictícia Souza','João Teste','Descrição privada','texto-privado','nota-interna','wpp-privado','wpp-robo','5548999990001','5548999990002','5511988880003','contato-privado','observação-interna'];
const semPrivados=(valor,rotulo)=>{const j=JSON.stringify(valor);for(const p of PRIVADOS)assert.equal(j.includes(p),false,`${rotulo}: apareceu "${p}"`);};
const rejeita=async(p,status,codigo)=>{try{await p;}catch(e){assert.equal(e.status,status,e.message);if(codigo)assert.equal(e.codigo,codigo);return;}assert.fail('deveria falhar '+status);};

(async()=>{
  const auditoria=[];
  const cat=criarCatalogo({ler,env:{}});
  const ctx=(role,companyId,username=role)=>({usuario:{id:username,username,role,companyId},origem:'painel',auditar:async(...a)=>auditoria.push(a)});
  const admin=ctx('admin',null),atA=ctx('atendimento',A,'ana'),atB=ctx('atendimento',B,'bruno'),semEmpresa=ctx('atendimento',null,'sem'),cliente=ctx('cliente',A);
  const run=async(nome,args,c)=>(await cat.executar(nome,args,c)).resultado;

  // máscaras
  assert.equal(iniciais('Maria Fictícia Souza'),'M. S.');assert.equal(iniciais('João'),'J.');assert.equal(iniciais(''),null);
  assert.equal(mascararTelefone('5548999990001'),'***0001');

  // estatísticas
  let r=await run('estatisticas',{},admin);
  assert.deepEqual(r.solicitacoes,{total:4,novo:2,em_andamento:1,aguardando_cliente:0,resolvido:1});
  assert.deepEqual(r.whatsapp,{total:3,robo:2,humano:1,pediramAtendente:1,janelaAberta:2});
  assert.equal(r.empresas.total,2);
  r=await run('estatisticas',{},atA);
  assert.equal(r.solicitacoes.total,3);assert.equal(r.whatsapp.total,2);assert.equal(r.empresas,undefined,'Atendimento não vê total de empresas');
  assert.equal((await run('estatisticas',{},{origem:'local'})).solicitacoes.total,4,'Local age como admin');
  await rejeita(cat.executar('estatisticas',{},semEmpresa),403,'sem_empresa');
  await rejeita(cat.executar('estatisticas',{},cliente),403,'sem_permissao');

  // listar solicitações
  r=await run('listar_solicitacoes',{},atA);
  assert.equal(r.total,3);assert.deepEqual(r.itens.map(x=>x.assunto),['Orçamento cozinha','Reforma do banheiro','Pintura da sala'],'Mais recentes primeiro');
  assert.equal(r.itens[2].cliente,'M. S.');assert.equal(r.itens[2].mensagens,2);
  semPrivados(r,'listar_solicitacoes');
  assert.equal((await run('listar_solicitacoes',{},atB)).total,1,'Empresa B só vê a sua');
  assert.equal((await run('listar_solicitacoes',{status:'novo'},admin)).total,2);
  r=await run('listar_solicitacoes',{porPagina:2},admin);
  assert.equal(r.itens.length,2);assert.equal(r.temMais,true);
  r=await run('listar_solicitacoes',{porPagina:2,pagina:2},admin);
  assert.equal(r.itens.length,2);assert.equal(r.temMais,false);
  await rejeita(cat.executar('listar_solicitacoes',{porPagina:51},admin),400);
  await rejeita(cat.executar('listar_solicitacoes',{status:'qualquer'},admin),400);

  // ler solicitação: só admin, com conteúdo
  const idA=DADOS['solicitacoes.json'][0].id;
  await rejeita(cat.executar('ler_solicitacao',{id:idA},atA),403,'sem_permissao');
  r=await run('ler_solicitacao',{id:idA},admin);
  assert.equal(r.descricao,'Descrição privada de Maria Fictícia Souza');
  assert.deepEqual(r.mensagens.map(m=>[m.texto,m.notaInterna]),[['texto-privado-1',false],['nota-interna-1',true]]);
  await rejeita(cat.executar('ler_solicitacao',{id:crypto.randomUUID()},admin),404);
  await rejeita(cat.executar('ler_solicitacao',{id:'../usuarios'},admin),400);
  auditoria.length=0;await run('ler_solicitacao',{id:idA},admin);
  assert.deepEqual(auditoria[0].slice(0,2),['ferramenta_ler_solicitacao','admin']);assert.equal(JSON.stringify(auditoria).includes(idA),false,'Auditoria sem valores');

  // conversas
  r=await run('listar_conversas_whatsapp',{},atA);
  assert.equal(r.total,2);assert.equal(r.itens[0].telefone,'***0001');assert.equal(r.itens[0].cliente,'M. S.');
  assert.equal(r.itens[0].janelaAberta,true);assert.equal(r.itens[1].janelaAberta,false);
  semPrivados(r,'listar_conversas');
  assert.equal((await run('listar_conversas_whatsapp',{modo:'humano'},admin)).total,1);
  assert.equal((await run('listar_conversas_whatsapp',{pediuAtendente:true},admin)).total,1);
  assert.equal((await run('listar_conversas_whatsapp',{pediuAtendente:false},admin)).total,2);
  assert.equal((await run('listar_conversas_whatsapp',{},atB)).itens[0].telefone,'***0003');
  const convA=DADOS['conversas-whatsapp.json'][0].id;
  await rejeita(cat.executar('ler_conversa_whatsapp',{id:convA},atA),403);
  r=await run('ler_conversa_whatsapp',{id:convA,ultimas:1},admin);
  assert.deepEqual(r.mensagens.map(m=>m.texto),['wpp-robo-1']);assert.equal(r.telefone,'***0001');
  assert.equal(JSON.stringify(r).includes('5548999990001'),false,'Telefone mascarado mesmo na leitura completa');

  // empresas
  await rejeita(cat.executar('listar_empresas',{},atA),403);
  r=await run('listar_empresas',{},admin);
  assert.deepEqual(r.itens.map(e=>e.nome),['Empresa Fictícia B','Empresa Fictícia A']);
  semPrivados(r,'listar_empresas');

  // MCP: conteúdo de clientes só com liberação explícita
  const mcpPadrao=criarServidorMcp({registro:cat});
  await mcpPadrao({jsonrpc:'2.0',id:1,method:'initialize',params:{}});
  const lista=(await mcpPadrao({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.map(t=>t.name);
  assert.equal(lista.includes('ler_solicitacao')||lista.includes('ler_conversa_whatsapp'),false,'MCP padrão sem conteúdo de clientes');
  assert.ok(lista.includes('listar_solicitacoes'));
  assert.equal((await mcpPadrao({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'ler_solicitacao',arguments:{id:idA}}})).error.code,-32602);
  const viaMcp=(await mcpPadrao({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'listar_conversas_whatsapp',arguments:{}}})).result;
  semPrivados(viaMcp,'MCP listar_conversas');
  const mcpLiberado=criarServidorMcp({registro:cat,permitirDadosPessoais:true});
  await mcpLiberado({jsonrpc:'2.0',id:1,method:'initialize',params:{}});
  assert.ok((await mcpLiberado({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.some(t=>t.name==='ler_solicitacao'),'Com ATENDE_MCP_DADOS_PESSOAIS=1 aparece');

  await rotaReal();
  console.log('OK: ferramentas de leitura do negócio — empresa isolada, iniciais e telefone mascarado, paginação, conteúdo só para admin e MCP sem dados pessoais por padrão.');
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});

/** No servidor real: o atendimento da empresa A só enxerga a empresa A. */
async function rotaReal(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-neg-'));
  const data=path.join(base,'data');await fs.mkdir(data);
  await require('./arquivos-servidor').copiar(root,base);
  await fs.cp(path.join(root,'site'),path.join(base,'site'),{recursive:true});
  for(const [nome,valor] of Object.entries(DADOS))await fs.writeFile(path.join(data,nome),JSON.stringify(valor));
  const {hashPassword}=require(path.join(base,'auth.js'));
  const pw='Senha-Ficticia-2026!',u=(username,role,companyId)=>({id:crypto.randomUUID(),username,name:username,role,companyId,active:true,mustChangePassword:false,createdAt:new Date().toISOString(),...hashPassword(pw)});
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([u('admin.teste','admin',null),u('ana.teste','atendimento',A)]));
  const port=38000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['server.js'],{cwd:base,stdio:'ignore',env:{...process.env,ATENDE_DATA_DIR:data,PORT:String(port),GEMINI_API_KEY:'',TAILSCALE_HOST:'',WHATSAPP_TOKEN:'',WHATSAPP_APP_SECRET:'',WHATSAPP_VERIFY_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''}});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const call=async(route,method='GET',body=null,s=null)=>{const headers={Origin:origin};if(s){headers.Cookie=s.cookie;headers['X-CSRF-Token']=s.csrf;}if(body!==null)headers['Content-Type']='application/json';
    const r=await fetch(origin+route,{method,headers,body:body!==null?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  try{
    for(let i=0;i<80;i++){try{if((await call('/api/status')).status===200)break;}catch{}await wait(100);}
    const login=async n=>{const r=await call('/api/auth/login','POST',{username:n,password:pw});assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf};};
    const ana=await login('ana.teste'),admin=await login('admin.teste');
    let r=await call('/api/ferramentas/listar_solicitacoes','POST',{args:{}},ana);
    assert.equal(r.status,200);assert.equal(r.data.resultado.total,3,'Servidor real: só a empresa A');
    semPrivados(r.data,'rota listar_solicitacoes');
    assert.equal((await call('/api/ferramentas/ler_solicitacao','POST',{args:{id:DADOS['solicitacoes.json'][0].id}},ana)).status,403);
    r=await call('/api/ferramentas/estatisticas','POST',{},admin);
    assert.equal(r.data.resultado.solicitacoes.total,4);
    const aud=(await call('/api/admin/audit','GET',null,admin)).data.items.map(x=>x.action);
    assert.ok(aud.includes('ferramenta_listar_solicitacoes')&&aud.includes('ferramenta_estatisticas'));
  }finally{
    server.kill();await wait(300);await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
    await fs.rm(process.env.ATENDE_DATA_DIR,{recursive:true,force:true}).catch(()=>{});
  }
}
