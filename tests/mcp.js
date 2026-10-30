'use strict';
// Servidor MCP por stdio: protocolo JSON-RPC, política de ferramentas (ações só com
// ATENDE_MCP_ACOES=1 e confirmação), erros e saída limpa. Cliente e ferramentas fictícios.
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PassThrough}=require('node:stream');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const dataTemp=fs.mkdtempSync(path.join(os.tmpdir(),'atende-mcp-'));
process.env.ATENDE_DATA_DIR=dataTemp;
const {criarServidorMcp,conectar}=require(path.join(root,'mcp.js'));
const {criarRegistro}=require(path.join(root,'ferramentas.js'));

/** Cliente em memória: envia linhas e espera respostas por id. */
function clienteEmMemoria(tratar){
  const entrada=new PassThrough(),saida=new PassThrough(),linhas=[],espera=new Map();
  let buffer='';
  saida.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const l=buffer.slice(0,i);buffer=buffer.slice(i+1);linhas.push(l);const m=JSON.parse(l);
    const ids=Array.isArray(m)?m.map(x=>x.id):[m.id];for(const id of ids)espera.get(id)?.(Array.isArray(m)?m:m);}});
  conectar(tratar,entrada,saida);
  let seq=0;
  return {linhas,
    enviarBruto:l=>entrada.write(l+'\n'),
    notificar:(method,params)=>entrada.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'),
    pedir:(method,params,idFixo)=>new Promise(r=>{const id=idFixo??++seq;espera.set(id,r);entrada.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}),
    fechar:()=>entrada.end()};
}

(async()=>{
  try{
    const segredo='EAAsegredo-'+crypto.randomBytes(8).toString('hex');
    let contador=0;
    const registro=criarRegistro({env:{WHATSAPP_TOKEN:segredo}});
    registro.registrar({nome:'ler_numero',nivel:'leitura',entrada:{type:'object',properties:{n:{type:'integer',minimum:1,maximum:9}},required:['n']},executar:a=>({dobro:a.n*2,token:segredo})});
    registro.registrar({nome:'consultar_fora',nivel:'sensivel',executar:()=>'ok'});
    registro.registrar({nome:'somar',nivel:'acao',entrada:{type:'object',properties:{quanto:{type:'integer',minimum:1,maximum:5}},required:['quanto']},
      previa:a=>({vaiSomar:a.quanto}),executar:a=>({contador:contador+=a.quanto})});
    registro.registrar({nome:'quebrar',nivel:'leitura',executar:()=>{throw new Error('detalhe interno /caminho/secreto');}});
    const logs=[];

    // ---------- padrão: só consultas ----------
    let c=clienteEmMemoria(criarServidorMcp({registro,log:m=>logs.push(m)}));
    let r=await c.pedir('tools/list',{});
    assert.equal(r.error.code,-32600,'Antes do initialize');
    r=await c.pedir('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'teste',version:'1'}});
    assert.equal(r.result.protocolVersion,'2025-06-18');
    assert.deepEqual(r.result.capabilities,{tools:{listChanged:false}});
    assert.equal(r.result.serverInfo.name,'atende-ia');
    r=await c.pedir('initialize',{protocolVersion:'1999-01-01'});
    assert.equal(r.result.protocolVersion,'2025-11-25','Versão desconhecida: oferece a mais recente');
    c.notificar('notifications/initialized');
    assert.deepEqual((await c.pedir('ping',{})).result,{});

    r=await c.pedir('tools/list',{});
    const nomes=r.result.tools.map(t=>t.name);
    assert.deepEqual(nomes,['ler_numero','consultar_fora','quebrar'],'Ação escondida por padrão');
    const ler=r.result.tools[0];
    assert.equal(ler.inputSchema.type,'object');assert.equal(ler.annotations.readOnlyHint,true);
    assert.equal(r.result.tools[1].annotations.openWorldHint,true,'Sensível marcada como mundo aberto');

    r=await c.pedir('tools/call',{name:'ler_numero',arguments:{n:4}});
    assert.equal(r.result.isError,false);assert.equal(r.result.structuredContent.resultado.dobro,8);
    assert.equal(JSON.stringify(r).includes(segredo),false,'Saída sem segredo');
    assert.equal(r.result.structuredContent.resultado.token,'[oculto]');
    assert.deepEqual(JSON.parse(r.result.content[0].text),r.result.structuredContent,'Texto e estrutura iguais');

    r=await c.pedir('tools/call',{name:'ler_numero',arguments:{n:40}});
    assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/entrada_invalida/);
    r=await c.pedir('tools/call',{name:'ler_numero',arguments:{n:1,extra:true}});
    assert.equal(r.result.isError,true);
    r=await c.pedir('tools/call',{name:'somar',arguments:{quanto:1}});
    assert.equal(r.error.code,-32602,'Ação não liberada é desconhecida');
    assert.equal(contador,0);
    r=await c.pedir('tools/call',{name:'nao_existe',arguments:{}});
    assert.equal(r.error.code,-32602);
    r=await c.pedir('tools/call',{name:'ler_numero',arguments:[1]});
    assert.equal(r.error.code,-32602);
    r=await c.pedir('tools/call',{name:'quebrar',arguments:{}});
    assert.equal(r.result.isError,true);assert.equal(r.result.content[0].text,'Erro interno na ferramenta.','Sem detalhe interno para o cliente');
    assert.ok(logs.some(l=>l.includes('quebrar')),'Detalhe só no stderr');
    r=await c.pedir('resources/list',{});
    assert.equal(r.error.code,-32601);

    // Mensagens malformadas
    const antes=c.linhas.length;
    c.enviarBruto('{isto não é json');
    c.enviarBruto(JSON.stringify({jsonrpc:'1.0',id:99,method:'ping'}));
    await new Promise(res=>setTimeout(res,100));
    const novas=c.linhas.slice(antes).map(l=>JSON.parse(l));
    assert.equal(novas.find(m=>m.id===null&&m.error.code===-32700).error.message,'JSON inválido.');
    assert.equal(novas.find(m=>m.id===99).error.code,-32600);
    // Lote
    const lote=await new Promise(res=>{c.linhas.length;const id1=501,id2=502;const ouvir=setInterval(()=>{const l=c.linhas.find(x=>x.startsWith('['));if(l){clearInterval(ouvir);res(JSON.parse(l));}},10);
      c.enviarBruto(JSON.stringify([{jsonrpc:'2.0',id:id1,method:'ping'},{jsonrpc:'2.0',method:'notifications/x'},{jsonrpc:'2.0',id:id2,method:'tools/call',params:{name:'ler_numero',arguments:{n:2}}}]));});
    assert.deepEqual(lote.map(m=>m.id),[501,502]);
    assert.ok(c.linhas.every(l=>{try{JSON.parse(l);return true;}catch{return false;}}),'Toda linha de saída é JSON');
    c.fechar();

    // ---------- com ações liberadas: prévia e confirmação ----------
    c=clienteEmMemoria(criarServidorMcp({registro,permitirAcoes:true}));
    await c.pedir('initialize',{protocolVersion:'2025-06-18'});
    r=await c.pedir('tools/list',{});
    const somar=r.result.tools.find(t=>t.name==='somar');
    assert.ok(somar,'Ação aparece com ATENDE_MCP_ACOES=1');
    assert.equal(somar.annotations.destructiveHint,true);
    assert.ok(somar.inputSchema.properties.confirmacao,'Campo de confirmação no esquema');
    assert.match(somar.description,/duas etapas/);
    r=await c.pedir('tools/call',{name:'somar',arguments:{quanto:3}});
    assert.equal(r.result.structuredContent.requerConfirmacao,true);assert.equal(contador,0,'Prévia não executa');
    const codigo=r.result.structuredContent.confirmacao.codigo;
    r=await c.pedir('tools/call',{name:'somar',arguments:{quanto:2,confirmacao:codigo}});
    assert.equal(r.result.isError,true,'Código não serve para outros argumentos');assert.equal(contador,0);
    r=await c.pedir('tools/call',{name:'somar',arguments:{quanto:3,confirmacao:codigo}});
    assert.equal(r.result.isError,false);assert.equal(contador,3);
    r=await c.pedir('tools/call',{name:'somar',arguments:{quanto:3,confirmacao:codigo}});
    assert.equal(r.result.isError,true,'Código de uso único');assert.equal(contador,3);
    c.fechar();

    await processoReal();
    console.log('OK: servidor MCP por stdio — protocolo, ações escondidas por padrão, confirmação, erros sem detalhes internos e saída só com JSON.');
  }finally{
    fs.rmSync(dataTemp,{recursive:true,force:true});
  }
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});

/** O processo real: stdout só com protocolo, catálogo verdadeiro, sem segredos do ambiente. */
async function processoReal(){
  const segredos={WHATSAPP_TOKEN:'EAAreal-'+crypto.randomBytes(8).toString('hex'),WHATSAPP_APP_SECRET:'app-'+crypto.randomBytes(8).toString('hex'),
    WHATSAPP_VERIFY_TOKEN:'verificacao-'+crypto.randomBytes(8).toString('hex'),WHATSAPP_PHONE_NUMBER_ID:'100000000000555',GEMINI_API_KEY:'AIzaFicticia-'+crypto.randomBytes(10).toString('hex')};
  const p=spawn(process.execPath,[path.join(root,'mcp.js')],{env:{...process.env,...segredos,ATENDE_DATA_DIR:dataTemp,PORT:'3997',WHATSAPP_PORT:'3996'},stdio:['pipe','pipe','pipe']});
  let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  const msgs=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'diagnostico',arguments:{}}}];
  p.stdin.end(msgs.map(m=>JSON.stringify(m)).join('\n')+'\n');
  const codigo=await new Promise(r=>p.on('close',r));
  assert.equal(codigo,0,err);
  const linhas=out.trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(linhas.map(m=>m.id),[1,2,3]);
  assert.deepEqual(linhas[1].result.tools.map(t=>t.name),['diagnostico','diagnostico_testar_conexoes']);
  const diag=linhas[2].result.structuredContent.resultado;
  assert.equal(diag.esquema,1);
  assert.equal(diag.itens.find(i=>i.id==='whatsapp.config').configurado,true,'Lê o ambiente do próprio processo');
  for(const v of Object.values(segredos))assert.equal(out.includes(v),false,'Segredo na saída do MCP');
  assert.match(err,/somente consultas/);
}
