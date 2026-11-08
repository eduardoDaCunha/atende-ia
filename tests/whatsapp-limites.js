'use strict';
// Webhook do WhatsApp: tempos limite, limite de conexões, corpo declarado grande e limite por IP.
// Sem rede: o envio à Meta é substituído por uma função falsa; dados fictícios.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const os=require('node:os');
const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
process.env.ATENDE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'atende-wpp-lim-'));
process.env.GEMINI_API_KEY='';
const {createWebhook,loadConfig,ROUTE}=require('../whatsapp');

(async()=>{
  const secret='segredo-de-teste-'+crypto.randomBytes(8).toString('hex');
  const config=loadConfig({WHATSAPP_VERIFY_TOKEN:'verificacao-'+crypto.randomBytes(8).toString('hex'),WHATSAPP_APP_SECRET:secret,WHATSAPP_TOKEN:'token-ficticio',WHATSAPP_PHONE_NUMBER_ID:'100000000000001'});
  // O IP vem da função passada pelo servidor (no server.js: visitante(), com proxy confiável e IPv6 /64).
  const server=createWebhook(config,{send:async()=>{},log:{log(){},error(){}},ipDe:req=>String(req.headers['x-teste-ip']||'sem-ip')});
  // Mesmo padrão do server.js.
  assert.equal(server.headersTimeout,10_000);
  assert.equal(server.requestTimeout,15_000);
  assert.equal(server.keepAliveTimeout,5_000);
  assert.equal(server.maxRequestsPerSocket,100);
  assert.equal(server.maxHeadersCount,64);
  assert.equal(server.maxConnections,128);
  assert.equal(server.timeout,30_000);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const evento=JSON.stringify({object:'whatsapp_business_account',entry:[]});
    const assinar=raw=>'sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
    const post=ip=>fetch(base+ROUTE,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':assinar(evento),'X-Teste-IP':ip},body:evento});

    // Corpo declarado acima de 256 KB é recusado antes da leitura.
    const grande=await new Promise((resolve,reject)=>{
      const s=net.connect(server.address().port,'127.0.0.1',()=>s.write(`POST ${ROUTE} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Teste-IP: 192.0.2.99\r\nContent-Type: application/json\r\nContent-Length: 300000\r\n\r\n`));
      let dados='';s.on('data',d=>{dados+=d;if(dados.includes('\r\n\r\n')){s.destroy();resolve(dados);}});s.on('error',reject);
    });
    assert.match(grande,/^HTTP\/1\.1 413/,'Content-Length acima do limite');

    // Limite por IP (300 por minuto) só para o que vem sem assinatura válida; outro IP não é afetado.
    const semAssinatura=ip=>fetch(base+ROUTE,{method:'POST',headers:{'Content-Type':'application/json','X-Teste-IP':ip},body:evento});
    const assinaturaErrada=ip=>fetch(base+ROUTE,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+'0'.repeat(64),'X-Teste-IP':ip},body:evento});
    let bloqueio=null;
    for(let lote=0;lote<320&&!bloqueio;lote+=20){
      const r=await Promise.all(Array.from({length:20},()=>semAssinatura('198.51.100.1')));
      for(const x of r){await x.text();if(x.status===429&&!bloqueio)bloqueio=x;else if(x.status!==429)assert.equal(x.status,401);}
    }
    assert.ok(bloqueio,'Limite por IP no webhook para o que vem sem assinatura');
    assert.equal(bloqueio.headers.get('retry-after'),'60');
    assert.equal((await assinaturaErrada('198.51.100.1')).status,429,'Assinatura errada também conta no limite');
    assert.equal((await post('198.51.100.1')).status,200,'Evento com assinatura válida do mesmo IP não é barrado');
    const verificacao=await fetch(base+ROUTE+'?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1',{headers:{'X-Teste-IP':'198.51.100.1'}});
    assert.equal(verificacao.status,429,'GET sem assinatura conta no limite');
    assert.equal((await semAssinatura('198.51.100.2')).status,401,'Outro IP segue com a própria cota');

    // Assinados não gastam a cota: 400 eventos válidos de um IP, todos aceitos.
    for(let lote=0;lote<400;lote+=50)await Promise.all(Array.from({length:50},()=>post('198.51.100.3').then(async r=>{await r.text();assert.equal(r.status,200);})));
    assert.equal((await semAssinatura('198.51.100.3')).status,401,'Eventos assinados não consumiram a cota do IP');

    // Tabela de IPs cheia: IPs novos continuam sendo atendidos e o IP barrado continua barrado.
    for(let i=0;i<1100;i+=50)await Promise.all(Array.from({length:50},(_,j)=>semAssinatura(`203.0.${Math.floor((i+j)/250)}.${(i+j)%250}`).then(async r=>{await r.text();assert.equal(r.status,401);})));
    assert.equal((await semAssinatura('198.51.100.1')).status,429,'Bloqueio ativo sobrevive à tabela cheia');
    console.log('OK: webhook com tempos limite, limite de conexões, corpo declarado grande recusado e limite por IP só para o que vem sem assinatura válida.');
  }finally{server.close();server.closeAllConnections?.();}
})().catch(err=>{console.error(err);process.exitCode=1;});
