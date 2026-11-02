'use strict';
// Lista única dos arquivos que os testes copiam para subir o servidor numa pasta temporária.
// Ao criar um módulo novo usado pelo server.js, inclua-o SÓ aqui.
const fs = require('node:fs/promises');
const path = require('node:path');
const ARQUIVOS = ['server.js','auth.js','store.js','resposta.js','whatsapp.js','conversas.js','diagnostico.js','sanitizar.js','ferramentas.js','catalogo.js','negocio.js','setup-admin.js','empresa.json'];
const PASTAS = [];
async function copiar(origem, destino) {
  await fs.mkdir(destino, { recursive: true });
  for (const nome of ARQUIVOS) await fs.copyFile(path.join(origem, nome), path.join(destino, nome));
  for (const nome of PASTAS) await fs.cp(path.join(origem, nome), path.join(destino, nome), { recursive: true });
}
module.exports = { ARQUIVOS, PASTAS, copiar };
