'use strict';
// Execute com servidor LOCAL da v0.3.8.2 ativo: node scripts/testar-site.js
const base=`http://127.0.0.1:${process.env.PORT || 3011}`;
let failed=0;
async function check(label, verify) {
  try { const ok=await verify();console.log(`${ok?'OK':'FALHOU'} - ${label}`);if(!ok)failed++; }
  catch(err){console.log(`FALHOU - ${label}: ${err.message}`);failed++;}
}
(async()=>{
 await check('Página comercial pública',async()=>{const r=await fetch(base);return r.ok&&(await r.text()).includes('Atende.IA');});
 await check('Página de termos pública',async()=>{const r=await fetch(base+'/termos');return r.ok&&(await r.text()).includes('Termos e condições da demonstração');});
 await check('Política de privacidade pública',async()=>{const r=await fetch(base+'/privacidade');return r.ok&&(await r.text()).includes('Política de privacidade da demonstração');});
 await check('Favicon WebP abaixo de 300 KB',async()=>{const r=await fetch(base+'/favicon.webp');const a=await r.arrayBuffer();return r.ok&&r.headers.get('content-type')==='image/webp'&&a.byteLength<300*1024;});
 await check('CSS comprimido em gzip',async()=>{const r=await fetch(base+'/style.css',{headers:{'Accept-Encoding':'gzip'}});return r.ok&&r.headers.get('content-encoding')==='gzip';});
 await check('CSS com validação de cache ETag',async()=>{const r=await fetch(base+'/style.css');const e=r.headers.get('etag');if(!e)return false;const next=await fetch(base+'/style.css',{headers:{'If-None-Match':e}});return next.status===304;});
 await check('Área administrativa protegida',async()=>{const r=await fetch(base+'/admin',{redirect:'manual'});return r.status===302&&r.headers.get('location')==='/acesso';});
 await check('Indexação bloqueada no localhost',async()=>{const r=await fetch(base+'/robots.txt');return r.ok&&(await r.text()).includes('Disallow: /');});
 await check('Site público mostra termos',async()=>{const r=await fetch(base);return (await r.text()).includes('href="/termos"');});
 await check('Site público indica a política',async()=>{const r=await fetch(base);return (await r.text()).includes('href="/privacidade"');});
 console.log(failed?`\n${failed} testes falharam. Confira servidor e arquivos.`:'\nTodos os testes automáticos locais passaram.');
 process.exitCode=failed?1:0;
})().catch(err=>{console.error(err);process.exitCode=1});
