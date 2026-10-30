'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','site');const html=path.join(root,'publico','index.html');
const src=fs.readFileSync(html,'utf8'); const css=fs.readFileSync(path.join(root,'publico','style.css'),'utf8');
const checks=[
 ['Termos no rodapé',src.includes('href="/termos"')],
 ['Política no rodapé',src.includes('href="/privacidade"')],
 ['Sem depoimentos ou métricas inventados',!/<(?:section|div)[^>]+(?:testimonials|ratings|counter|reviews)[^>]*>/i.test(src)],
 ['Sem slogan feito com IA',!/feito (com|por) ia|powered by ai/i.test(src)],
 ['Botões com bordas discretas',/\.btn,\.hero-actions \.btn,\.pill/.test(css) && /border-radius:8px!important/.test(css)],
 ['Site continua em demonstração',src.includes('Não informe dados reais')],
 ['Sem fonte remota',!/@import\s+url\(\s*["']?https?:/i.test(css)],
];
let fails=0;for (const [name,passed] of checks){console.log((passed?'OK':'FALHOU')+' | '+name);if(!passed) fails++} process.exitCode=fails?1:0;
