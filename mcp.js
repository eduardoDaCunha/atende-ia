/** Atende.IA — servidor MCP local (Model Context Protocol) por stdio.
 *
 *  Expõe as ferramentas do catálogo para clientes MCP (Claude Code, Maestri...)
 *  rodando no mesmo computador. Não abre porta de rede: o cliente inicia este
 *  processo e conversa por entrada/saída padrão, uma mensagem JSON-RPC 2.0 por linha.
 *
 *  Política: por padrão só ferramentas de leitura e "sensivel" (consultas). Ações
 *  aparecem apenas com ATENDE_MCP_ACOES=1 e, mesmo assim, exigem a confirmação em
 *  duas etapas do núcleo. Tudo passa por ferramentas.js: validação, limite e
 *  saída sem segredos. A saída padrão é exclusiva do protocolo; avisos vão para stderr.
 */
'use strict';
const readline = require('node:readline');
const { VERSAO } = require('./diagnostico');

const VERSOES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_LINHA = 1_000_000;
const ERROS = { parse:-32700, requisicao:-32600, metodo:-32601, parametros:-32602, interno:-32603 };

/** Esquema MCP de uma ferramenta: ações ganham o campo opcional "confirmacao". */
function paraMcp(f) {
  const inputSchema = JSON.parse(JSON.stringify(f.entrada));
  if (f.exigeConfirmacao) {
    inputSchema.properties.confirmacao = { type:'string', description:'Código devolvido pela prévia. Sem ele, a chamada só mostra a prévia e nada é alterado.' };
  }
  return {
    name:f.nome, title:f.titulo,
    description: f.descricao + (f.exigeConfirmacao ? ' Ação em duas etapas: chame sem "confirmacao" para ver a prévia; repita com o código para executar. Confirme com a pessoa antes.' : ''),
    inputSchema,
    annotations:{ title:f.titulo, readOnlyHint:f.nivel !== 'acao', destructiveHint:f.nivel === 'acao', idempotentHint:f.nivel !== 'acao', openWorldHint:f.nivel === 'sensivel' },
  };
}

/**
 * Cria o tratador de mensagens. opcoes: registro (catálogo), permitirAcoes (bool), log (stderr).
 * Retorna tratar(mensagem) => resposta | null (notificações não têm resposta).
 */
function criarServidorMcp({ registro, permitirAcoes=false, permitirDadosPessoais=false, log=m => process.stderr.write(m+'\n') }) {
  const contexto = { origem:'local' };
  // O cliente MCP repassa as respostas a um modelo de IA: conteúdo de clientes só com liberação explícita.
  const visiveis = () => registro.listar(contexto).filter(f => (permitirAcoes || f.nivel !== 'acao') && (permitirDadosPessoais || !f.dadosPessoais));
  let iniciado = false;

  const resposta = (id, result) => ({ jsonrpc:'2.0', id, result });
  const falha = (id, code, message) => ({ jsonrpc:'2.0', id, error:{ code, message } });

  async function chamarFerramenta(id, params) {
    const nome = params?.name, args = params?.arguments ?? {};
    if (typeof nome !== 'string') return falha(id, ERROS.parametros, 'Informe o nome da ferramenta.');
    const f = visiveis().find(x => x.nome === nome);
    if (!f) return falha(id, ERROS.parametros, `Ferramenta desconhecida ou não liberada no MCP: ${nome}`);
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return falha(id, ERROS.parametros, 'arguments deve ser um objeto.');
    const { confirmacao, ...resto } = args;
    try {
      const saida = await registro.executar(nome, resto, contexto, f.exigeConfirmacao && typeof confirmacao === 'string' ? confirmacao : undefined);
      return resposta(id, { content:[{ type:'text', text:JSON.stringify(saida, null, 2) }], structuredContent:saida, isError:false });
    } catch (err) {
      // Erros da ferramenta voltam como resultado, para o modelo poder corrigir a chamada.
      const texto = err.status ? `${err.message}${err.codigo ? ` (${err.codigo})` : ''}` : 'Erro interno na ferramenta.';
      if (!err.status) log(`MCP: falha interna em ${nome}: ${err.message}`);
      return resposta(id, { content:[{ type:'text', text:texto }], isError:true });
    }
  }

  return async function tratar(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
      return falha(msg && typeof msg === 'object' && 'id' in msg ? msg.id : null, ERROS.requisicao, 'Requisição JSON-RPC inválida.');
    const notificacao = !('id' in msg), { id, method, params } = msg;
    if (notificacao) return null; // notifications/initialized, cancelled etc.: nada a responder
    switch (method) {
      case 'initialize': {
        iniciado = true;
        const pedida = params?.protocolVersion;
        return resposta(id, {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities:{ tools:{ listChanged:false } },
          serverInfo:{ name:'atende-ia', title:'Atende.IA', version:VERSAO },
          instructions:'Ferramentas do Atende.IA (protótipo local). Nunca exibem segredos, telefones ou caminhos. Ações exigem prévia e confirmação; confirme com a pessoa antes de enviar o código.',
        });
      }
      case 'ping': return resposta(id, {});
      case 'tools/list':
        if (!iniciado) return falha(id, ERROS.requisicao, 'Chame initialize primeiro.');
        return resposta(id, { tools:visiveis().map(paraMcp) });
      case 'tools/call':
        if (!iniciado) return falha(id, ERROS.requisicao, 'Chame initialize primeiro.');
        return chamarFerramenta(id, params);
      default: return falha(id, ERROS.metodo, `Método não suportado: ${method}`);
    }
  };
}

/** Liga o tratador a fluxos de entrada/saída (stdio no uso real; fluxos em memória nos testes). */
function conectar(tratar, entrada, saida) {
  const escrever = obj => saida.write(JSON.stringify(obj) + '\n');
  const rl = readline.createInterface({ input:entrada, crlfDelay:Infinity });
  const pendentes = new Set();
  rl.on('line', linha => {
    if (!linha.trim()) return;
    if (linha.length > MAX_LINHA) return escrever({ jsonrpc:'2.0', id:null, error:{ code:ERROS.requisicao, message:'Mensagem grande demais.' } });
    let msg;
    try { msg = JSON.parse(linha); } catch { return escrever({ jsonrpc:'2.0', id:null, error:{ code:ERROS.parse, message:'JSON inválido.' } }); }
    const tarefa = (async () => {
      if (Array.isArray(msg)) {
        const respostas = (await Promise.all(msg.map(tratar))).filter(Boolean);
        if (respostas.length) escrever(respostas);
      } else {
        const r = await tratar(msg);
        if (r) escrever(r);
      }
    })().catch(err => escrever({ jsonrpc:'2.0', id:msg?.id ?? null, error:{ code:ERROS.interno, message:'Erro interno.' } }));
    pendentes.add(tarefa); tarefa.finally(() => pendentes.delete(tarefa));
  });
  return { fechado:new Promise(r => rl.on('close', async () => { await Promise.all([...pendentes]); r(); })) };
}

if (require.main === module) {
  // Nada além do protocolo pode ir para a saída padrão.
  console.log = console.info = (...a) => process.stderr.write(a.join(' ') + '\n');
  const { criarCatalogo } = require('./catalogo');
  const permitirAcoes = process.env.ATENDE_MCP_ACOES === '1';
  const permitirDadosPessoais = process.env.ATENDE_MCP_DADOS_PESSOAIS === '1';
  const tratar = criarServidorMcp({ registro:criarCatalogo(), permitirAcoes, permitirDadosPessoais });
  conectar(tratar, process.stdin, process.stdout);
  process.stderr.write(`Atende.IA MCP ${VERSAO} pronto (stdio${permitirAcoes ? ', ações liberadas com confirmação' : ', somente consultas'}${permitirDadosPessoais ? ', COM conteúdo de clientes' : ', sem conteúdo de clientes'}).\n`);
}

module.exports = { criarServidorMcp, conectar, paraMcp, VERSOES };
