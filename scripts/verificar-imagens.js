// Atende.IA — validação de recursos visuais antes da publicação.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const site = path.resolve(__dirname, '..', 'site');
const allowed = new Set(['.webp']);
const imageExtensions = new Set(['.jpg','.jpeg','.png','.gif','.svg','.avif','.bmp','.ico','.webp']);
let total = 0; let errors = 0;
function walk(folder) {
  for (const entry of fs.readdirSync(folder, {withFileTypes:true})) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if(!imageExtensions.has(ext)) continue;
    const size = fs.statSync(full).size;
    total++;
    const ok = allowed.has(ext) && size < 300 * 1024;
    console.log(`${ok ? 'OK' : 'ERRO'} ${path.relative(site, full)} — ${(size/1024).toFixed(1)} KB`);
    if(!ok) errors++;
  }
}
walk(site);
if(!total) console.log('Nenhuma imagem encontrada.');
console.log(`Imagens verificadas: ${total} | fora do padrão: ${errors}`);
if(errors) process.exitCode = 1;
