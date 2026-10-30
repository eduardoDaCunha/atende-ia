'use strict';
// Conversas do WhatsApp no painel, ponta a ponta: servidor real + Graph API falsa local.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

(async()=>{
  const root=path.resolve(__dirname,'..');
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-wpp-painel-'));
  const data=path.join(base,'data');await fs.mkdir(data);
  for(const name of ['server.js','auth.js','store.js','resposta.js','whatsapp.js','conversas.js','empresa.json'])await fs.copyFile(path.join(root,name),path.join(base,name));
  await fs.cp(path.join(root,'site'),path.join(base,'site'),{recursive:true});
  const {hashPassword}=require(path.join(base,'auth.js'));

  // Empresas, usuários e uma conversa antiga (mais de 24 h) já com atendente.
  const empresaA=crypto.randomUUID(),empresaB=crypto.randomUUID(),pw='Senha-De-Teste-2026!';
  const now=new Date().toISOString();
  await fs.writeFile(path.join(data,'empresas.json'),JSON.stringify([empresaA,empresaB].map((id,i)=>({id,name:'Empresa Fictícia '+(i?'B':'A'),city:'Florianópolis',uf:'SC',timeZone:'America/Sao_Paulo',state:'ativa',createdAt:now}))));
  const user=(username,role,companyId)=>({id:crypto.randomUUID(),username,name:username==='ana.a'?'Ana Atendente':username,role,companyId,active:true,mustChangePassword:false,createdAt:now,...hashPassword(pw)});
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([user('admin.teste','admin',null),user('ana.a','atendimento',empresaA),user('bruno.b','atendimento',empresaB),user('cliente.a','cliente',empresaA)]));
  const antiga=new Date(Date.now()-25*60*60*1000).toISOString();
  const conversaAntiga={id:crypto.randomUUID(),telefone:'5548988887777',nome:'Cliente Antigo',companyId:empresaA,modo:'humano',atendente:'Ana Atendente',pedidoAtendente:false,
    mensagens:[{id:crypto.randomUUID(),de:'cliente',autor:'Cliente Antigo',texto:'mensagem antiga',em:antiga}],criadoEm:antiga,atualizadoEm:antiga,ultimaDoClienteEm:antiga};
  await fs.writeFile(path.join(data,'conversas-whatsapp.json'),JSON.stringify([conversaAntiga]));

  // Graph API falsa: guarda o que seria enviado ao WhatsApp.
  const enviados=[];
  const graph=http.createServer((req,res)=>{
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      assert.equal(req.headers.authorization,'Bearer token-ficticio');
      enviados.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'application/json'});res.end('{"messages":[{"id":"wamid.x"}]}');
    });
  });
  await new Promise(r=>graph.listen(0,'127.0.0.1',r));

  const port=34000+Math.floor(Math.random()*1000),wport=port+1000,origin=`http://127.0.0.1:${port}`;
  const secret='segredo-ficticio-'+crypto.randomBytes(6).toString('hex'),verify='verificacao-'+crypto.randomBytes(8).toString('hex');
  let saida='';
  const server=spawn(process.execPath,['server.js'],{cwd:base,stdio:'pipe',env:{...process.env,ATENDE_DATA_DIR:data,PORT:String(port),GEMINI_API_KEY:'',TAILSCALE_HOST:'',
    WHATSAPP_PORT:String(wport),WHATSAPP_VERIFY_TOKEN:verify,WHATSAPP_APP_SECRET:secret,WHATSAPP_TOKEN:'token-ficticio',WHATSAPP_PHONE_NUMBER_ID:'100000000000001',
    WHATSAPP_GRAPH_BASE:`http://127.0.0.1:${graph.address().port}`,WHATSAPP_EMPRESA_ID:empresaA,WHATSAPP_ALLOWED_NUMBERS:''}});
  server.stdout.on('data',d=>saida+=d);server.stderr.on('data',d=>saida+=d);

  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(check,label)=>{for(let i=0;i<60;i++){if(await check())return;await wait(100);}throw new Error('Tempo esgotado: '+label);};
  const call=async(route,method='GET',body=null,s=null,csrf=true)=>{
    const headers={Origin:origin};if(s){headers.Cookie=s.cookie;if(csrf)headers['X-CSRF-Token']=s.csrf;}
    if(body!==null)headers['Content-Type']='application/json';
    const r=await fetch(origin+route,{method,headers,body:body!==null?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async u=>{const r=await call('/api/auth/login','POST',{username:u,password:pw});assert.equal(r.status,200,u);return {cookie:r.cookie,csrf:r.data.csrf};};
  const webhook=(from,texto,nome='Cliente Teste')=>{
    const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'1',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'100000000000001'},
      contacts:[{wa_id:from,profile:{name:nome}}],messages:[{id:'wamid.'+crypto.randomUUID(),from,type:'text',timestamp:'1',text:{body:texto}}]}}]}]});
    return fetch(`http://127.0.0.1:${wport}/webhook/whatsapp`,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex')},body:raw});
  };

  try{
    await until(async()=>{try{return (await call('/api/status')).status===200&&(await fetch(`http://127.0.0.1:${wport}/x`)).status===404;}catch{return false;}},'servidor iniciar');

    // Portas separadas: o webhook não serve o painel e o painel não recebe o webhook.
    for(const p of ['/','/acesso','/api/status','/painel.js'])assert.equal((await fetch(`http://127.0.0.1:${wport}${p}`)).status,404,`${p} não existe na porta do WhatsApp`);
    assert.notEqual((await fetch(origin+'/webhook/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200,'Painel não aceita webhook');

    const ana=await login('ana.a'),bruno=await login('bruno.b'),admin=await login('admin.teste'),cliente=await login('cliente.a');
    const tel='5548999990001';

    // 1. Cliente escreve: robô responde e a conversa aparece para a empresa A.
    assert.equal((await webhook(tel,'Olá, bom dia')).status,200);
    await until(()=>enviados.length===1,'resposta do robô');
    assert.equal(enviados[0].to,tel);
    let lista=(await call('/api/staff/whatsapp','GET',null,ana)).data;
    assert.equal(lista.enabled,true);
    const conversa=lista.items.find(x=>x.telefone===tel);
    assert.ok(conversa,'Conversa nova aparece no painel');
    assert.equal(conversa.nome,'Cliente Teste');assert.equal(conversa.modo,'robo');
    // O envio à Graph termina antes de a resposta ser gravada no histórico.
    let detalhe;
    await until(async()=>(detalhe=(await call(`/api/staff/whatsapp/${conversa.id}`,'GET',null,ana)).data.item).mensagens.length===2,'resposta registrada');
    assert.deepEqual(detalhe.mensagens.map(m=>m.de),['cliente','robo']);

    // 2. Isolamento: outra empresa e clientes do painel não veem.
    assert.equal((await call('/api/staff/whatsapp','GET',null,bruno)).data.items.length,0,'Atendente de outra empresa não vê');
    assert.equal((await call(`/api/staff/whatsapp/${conversa.id}`,'GET',null,bruno)).status,404);
    assert.equal((await call(`/api/staff/whatsapp/${conversa.id}/assumir`,'POST',{},bruno)).status,404,'Outra empresa não assume');
    assert.equal((await call('/api/staff/whatsapp','GET',null,cliente)).status,403,'Cliente do painel não acessa');
    assert.equal((await call('/api/staff/whatsapp','GET',null,admin)).data.items.length,2,'Admin vê todas');

    // 3. Pedido de atendente vira alerta; responder sem assumir é bloqueado.
    await webhook(tel,'Quero falar com um atendente');
    await until(()=>enviados.length===2,'robô responde o pedido');
    assert.equal((await call(`/api/staff/whatsapp/${conversa.id}`,'GET',null,ana)).data.item.pedidoAtendente,true);
    assert.equal((await call(`/api/staff/whatsapp/${conversa.id}/mensagens`,'POST',{texto:'oi'},ana)).status,409,'Precisa assumir antes');

    // 4. Assumir: sem CSRF falha; com CSRF o robô para de responder.
    assert.equal((await call(`/api/staff/whatsapp/${conversa.id}/assumir`,'POST',{},ana,false)).status,403,'Exige CSRF');
    let r=await call(`/api/staff/whatsapp/${conversa.id}/assumir`,'POST',{},ana);
    assert.equal(r.status,200);assert.equal(r.data.item.modo,'humano');assert.equal(r.data.item.atendente,'Ana Atendente');assert.equal(r.data.item.pedidoAtendente,false);
    await webhook(tel,'Alguém aí?');
    await until(async()=>(await call(`/api/staff/whatsapp/${conversa.id}`,'GET',null,ana)).data.item.mensagens.length===5,'mensagem registrada');
    await wait(300);
    assert.equal(enviados.length,2,'Com atendente, o robô não responde');

    // 5. Atendente responde pelo painel: vai para o WhatsApp e fica no histórico.
    r=await call(`/api/staff/whatsapp/${conversa.id}/mensagens`,'POST',{texto:'Olá! Aqui é a Ana, posso ajudar.'},ana);
    assert.equal(r.status,200);
    assert.equal(enviados.length,3);assert.equal(enviados[2].to,tel);assert.equal(enviados[2].text.body,'Olá! Aqui é a Ana, posso ajudar.');
    const ultima=r.data.item.mensagens.at(-1);assert.equal(ultima.de,'atendente');assert.equal(ultima.autor,'Ana Atendente');

    // 6. Janela de 24 h vencida bloqueia texto livre.
    r=await call(`/api/staff/whatsapp/${conversaAntiga.id}/mensagens`,'POST',{texto:'oi'},ana);
    assert.equal(r.status,409);assert.match(r.data.error,/24 horas/);
    assert.equal(enviados.length,3,'Nada enviado fora da janela');

    // 7. Devolver ao robô: ele volta a responder.
    r=await call(`/api/staff/whatsapp/${conversa.id}/devolver`,'POST',{},ana);
    assert.equal(r.data.item.modo,'robo');
    await webhook(tel,'Obrigado!');
    await until(()=>enviados.length===4,'robô volta a responder');

    // 8. Auditoria e logs sem dados pessoais.
    const auditoria=(await call('/api/admin/audit','GET',null,admin)).data.items.map(x=>x.action);
    for(const a of ['whatsapp_assumir','whatsapp_resposta','whatsapp_devolver'])assert.ok(auditoria.includes(a),a+' auditado');
    assert.equal(/5548999990001|5548988887777|bom dia|falar com um atendente|Alguém aí|Obrigado|Ana, posso/.test(saida),false,'Logs sem número completo nem texto das mensagens');

    console.log('OK: conversas do WhatsApp no painel, robô/humano, CSRF, isolamento por empresa, janela de 24 h, auditoria e portas separadas.');
  }catch(err){
    console.error('Saída do servidor:\n'+saida);throw err;
  }finally{
    server.kill();graph.close();
    await wait(300);await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});
