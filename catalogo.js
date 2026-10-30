/** Atende.IA — catálogo das ferramentas de integração.
 *  Para criar uma ferramenta nova: registre aqui com definirFerramenta (ver ferramentas.js),
 *  escolha o nível certo e os perfis permitidos, e cubra em tests/ferramentas.js.
 */
'use strict';
const { criarRegistro } = require('./ferramentas');
const { coletarDiagnostico } = require('./diagnostico');

/** opcoes: dentroDoServidor (true no server.js), agora/env/fetch (injetáveis nos testes). */
function criarCatalogo(opcoes = {}) {
  const registro = criarRegistro({ agora:opcoes.agora, env:opcoes.env });
  const base = { env:opcoes.env, fetch:opcoes.fetch, dentroDoServidor:Boolean(opcoes.dentroDoServidor) };

  registro.registrar({
    nome:'diagnostico',
    titulo:'Diagnóstico do sistema',
    descricao:'Estado do servidor, da IA, do WhatsApp, dos alertas de segurança e limitações conhecidas. Só conversa com 127.0.0.1; não mostra segredos.',
    nivel:'leitura', perfis:['admin'],
    executar:() => coletarDiagnostico(base),
  });
  registro.registrar({
    nome:'diagnostico_testar_conexoes',
    titulo:'Diagnóstico com teste de conexões',
    descricao:'O diagnóstico mais duas leituras gratuitas (metadados do Gemini e id do número na Meta). Nunca envia mensagens.',
    nivel:'sensivel', perfis:['admin'], limitePorMinuto:5,
    executar:() => coletarDiagnostico({ ...base, testarConexoes:true }),
  });
  return registro;
}

// Linha de comando local: node catalogo.js listar | executar <nome> ['{"campo":"valor"}'] [--confirmar <código>]
// Roda como "local" (age como administrador). Não grava auditoria: outro processo não pode
// escrever nos arquivos do servidor (a fila do store.js vale só dentro de um processo).
if (require.main === module) {
  const [comando, nome, ...resto] = process.argv.slice(2);
  const i = resto.indexOf('--confirmar'), confirmacao = i >= 0 ? resto[i + 1] : undefined;
  const json = resto.find((x, j) => i < 0 || (j !== i && j !== i + 1));
  const registro = criarCatalogo();
  const contexto = { origem:'local' };
  (async () => {
    if (comando === 'listar') return console.log(JSON.stringify(registro.listar(contexto), null, 2));
    if (comando !== 'executar' || !nome) throw Object.assign(new Error('Uso: node catalogo.js listar | executar <nome> [json] [--confirmar <código>]'), { codigo:'uso' });
    let args = {};
    if (json) { try { args = JSON.parse(json); } catch { throw new Error('Argumentos devem ser JSON válido.'); } }
    console.log(JSON.stringify(await registro.executar(nome, args, contexto, confirmacao), null, 2));
  })().catch(err => { console.error(`Erro${err.codigo ? ' ('+err.codigo+')' : ''}: ${err.message}`); process.exitCode = 1; });
}

module.exports = { criarCatalogo };
