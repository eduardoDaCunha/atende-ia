'use strict';
// Testa o webhook do WhatsApp sem rede: o envio à Meta é substituído por uma função falsa.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
process.env.ATENDE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'atende-wpp-'));
process.env.GEMINI_API_KEY='';
const {createWebhook,loadConfig,isAllowed,ROUTE}=require('../whatsapp');

(async()=>{
  const secret='segredo-de-teste-'+crypto.randomBytes(8).toString('hex');
  const verify='verificacao-'+crypto.randomBytes(8).toString('hex');
  const config=loadConfig({WHATSAPP_VERIFY_TOKEN:verify,WHATSAPP_APP_SECRET:secret,WHATSAPP_TOKEN:'token-ficticio',WHATSAPP_PHONE_NUMBER_ID:'100000000000001',WHATSAPP_ALLOWED_NUMBERS:'+55 (48) 99999-0001'});
  assert.equal(loadConfig({}),null,'Sem configuração, o WhatsApp fica desligado');
  assert.throws(()=>loadConfig({WHATSAPP_TOKEN:'x'}),/incompleta/,'Configuração pela metade é recusada');
  assert.throws(()=>loadConfig({WHATSAPP_VERIFY_TOKEN:'curto',WHATSAPP_APP_SECRET:'x',WHATSAPP_TOKEN:'x',WHATSAPP_PHONE_NUMBER_ID:'1'}),/16 caracteres/,'Token de verificação curto é recusado');
  assert.ok(isAllowed('5548999990001',config.allowed),'Número autorizado');
  assert.ok(isAllowed('554899990001',config.allowed),'Número autorizado sem o nono dígito');
  assert.equal(isAllowed('5548988887777',config.allowed),false,'Outro número é bloqueado');

  const sent=[];const logs=[];
  const server=createWebhook(config,{send:async(to,text)=>{sent.push({to,text});},log:{log:m=>logs.push(m),error:m=>logs.push(m)}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const sign=raw=>'sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
  const post=(payload,signature)=>{const raw=typeof payload==='string'?payload:JSON.stringify(payload);return fetch(base+ROUTE,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature===undefined?sign(raw):signature},body:raw});};
  const event=(msgs,phoneId=config.phoneNumberId)=>({object:'whatsapp_business_account',entry:[{id:'1',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phoneId},messages:msgs}}]}]});
  const text=(id,from,body)=>({id,from,type:'text',timestamp:'1',text:{body}});
  try{
    // Verificação do webhook
    let r=await fetch(`${base}${ROUTE}?hub.mode=subscribe&hub.verify_token=${verify}&hub.challenge=12345`);
    assert.equal(r.status,200);assert.equal(await r.text(),'12345','Desafio devolvido com token correto');
    r=await fetch(`${base}${ROUTE}?hub.mode=subscribe&hub.verify_token=errado-errado-errado&hub.challenge=12345`);
    assert.equal(r.status,403,'Token de verificação errado é recusado');
    // Só a rota do webhook existe
    for(const p of ['/','/acesso','/api/status','/admin'])assert.equal((await fetch(base+p)).status,404,`${p} não existe no webhook`);
    // Assinatura
    assert.equal((await post(event([text('a1','5548999990001','oi')]),'')).status,401,'Sem assinatura é recusado');
    assert.equal((await post(event([text('a2','5548999990001','oi')]),'sha256='+'0'.repeat(64))).status,401,'Assinatura falsa é recusada');
    assert.equal((await post('{"x":',)).status,400,'JSON inválido assinado é recusado');
    assert.equal((await post('x'.repeat(300_000))).status,413,'Corpo grande demais é recusado');
    await server.idle();assert.equal(sent.length,0,'Nada é enviado sem assinatura válida');
    // Mensagem válida
    r=await post(event([text('m1','5548999990001','Quais serviços vocês fazem?')]));
    assert.equal(r.status,200);await server.idle();
    assert.equal(sent.length,1,'Mensagem válida recebe resposta');
    assert.equal(sent[0].to,'5548999990001','Resposta vai para quem escreveu');
    assert.match(sent[0].text,/servi/i,'Resposta fala dos serviços');
    assert.equal(/Simular orçamento/.test(sent[0].text),false,'No WhatsApp não cita botão do site');
    // Duplicada, número não autorizado, outro número da empresa e mídia
    await post(event([text('m1','5548999990001','Quais serviços vocês fazem?')]));
    await post(event([text('m2','5548988887777','oi')]));
    await post(event([text('m3','5548999990001','oi')],'999999'));
    await post(event([{id:'m4',from:'5548999990001',type:'image',image:{id:'1'}}]));
    await server.idle();
    assert.equal(sent.length,2,'Duplicadas, não autorizados e outro número são ignorados');
    assert.match(sent[1].text,/apenas mensagens de texto/,'Mídia recebe aviso de texto');
    // Status de entrega não gera resposta
    await post({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneNumberId},statuses:[{id:'s1',status:'delivered'}]}}]}]});
    await server.idle();assert.equal(sent.length,2,'Status de entrega é ignorado');
    // Logs não expõem número completo nem texto
    assert.ok(logs.length>0);
    assert.equal(logs.some(l=>/5548999990001|5548988887777|servi/.test(l)),false,'Logs não contêm número completo nem mensagem');
    console.log('OK: WhatsApp webhook verificado, assinatura obrigatória, rota única, lista de números, duplicadas, mídia e logs sem dados pessoais.');
  }finally{
    await new Promise(r=>server.close(r));
    fs.rmSync(process.env.ATENDE_DATA_DIR,{recursive:true,force:true});
  }
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});
