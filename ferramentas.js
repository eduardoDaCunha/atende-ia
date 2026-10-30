/** Atende.IA — núcleo das ferramentas de integração.
 *
 *  Toda ferramenta (painel, linha de comando e, no futuro, MCP) passa pelo mesmo
 *  caminho: validação da entrada, permissão por perfil, limite de uso, auditoria
 *  sem conteúdo e limpeza de segredos na saída. Ferramentas de nível "acao" só
 *  executam com confirmação em duas etapas: a primeira chamada devolve uma
 *  prévia e um código de uso único, válido por 5 minutos, que só confirma
 *  aquela ferramenta, aqueles argumentos e aquele usuário.
 */
'use strict';
const crypto = require('node:crypto');
const { semSegredos } = require('./sanitizar');

const NIVEIS = {
  leitura:  { limite:60, descricao:'Só consulta; não altera nada.' },
  sensivel: { limite:5,  descricao:'Só consulta, mas usa serviços externos ou dados restritos.' },
  acao:     { limite:10, descricao:'Altera dados ou envia algo; exige confirmação.' },
};
const PERFIS = ['admin', 'atendimento', 'cliente'];
const CONFIRMACAO_MS = 5 * 60_000;

function erro(status, codigo, mensagem) { return Object.assign(new Error(mensagem), { status, codigo }); }

// ---------- validação (subconjunto pequeno de JSON Schema) ----------
const TIPOS = { string:v => typeof v === 'string', boolean:v => typeof v === 'boolean',
  integer:v => Number.isInteger(v), number:v => typeof v === 'number' && Number.isFinite(v) };
function validarEsquema(esquema) {
  if (esquema.type !== 'object' || typeof esquema.properties !== 'object') throw new Error('A entrada deve ser { type:"object", properties }');
  for (const [campo, regra] of Object.entries(esquema.properties))
    if (!TIPOS[regra.type]) throw new Error(`Tipo não suportado em ${campo}: ${regra.type}`);
  for (const campo of esquema.required || []) if (!esquema.properties[campo]) throw new Error(`Campo obrigatório sem definição: ${campo}`);
}
/** Valida e devolve só os campos conhecidos (com valores padrão aplicados). */
function validarArgs(esquema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw erro(400, 'entrada_invalida', 'Os argumentos devem ser um objeto.');
  const desconhecidos = Object.keys(args).filter(k => !esquema.properties[k]);
  if (desconhecidos.length) throw erro(400, 'entrada_invalida', `Campo desconhecido: ${desconhecidos.join(', ')}.`);
  const limpo = {};
  for (const [campo, regra] of Object.entries(esquema.properties)) {
    let v = args[campo];
    if (v === undefined && regra.default !== undefined) v = regra.default;
    if (v === undefined) {
      if ((esquema.required || []).includes(campo)) throw erro(400, 'entrada_invalida', `Informe ${campo}.`);
      continue;
    }
    if (!TIPOS[regra.type](v)) throw erro(400, 'entrada_invalida', `${campo} deve ser ${regra.type}.`);
    if (regra.enum && !regra.enum.includes(v)) throw erro(400, 'entrada_invalida', `${campo} deve ser um de: ${regra.enum.join(', ')}.`);
    if (regra.type === 'string') {
      if (regra.minLength !== undefined && v.length < regra.minLength) throw erro(400, 'entrada_invalida', `${campo} muito curto.`);
      if (v.length > (regra.maxLength ?? 2000)) throw erro(400, 'entrada_invalida', `${campo} muito longo.`);
      if (regra.pattern && !new RegExp(regra.pattern).test(v)) throw erro(400, 'entrada_invalida', `${campo} em formato inválido.`);
    }
    if (regra.minimum !== undefined && v < regra.minimum) throw erro(400, 'entrada_invalida', `${campo} abaixo do mínimo.`);
    if (regra.maximum !== undefined && v > regra.maximum) throw erro(400, 'entrada_invalida', `${campo} acima do máximo.`);
    limpo[campo] = v;
  }
  return limpo;
}

/**
 * Define uma ferramenta. Campos:
 *  nome (snake_case), titulo, descricao, nivel (leitura|sensivel|acao), perfis (padrão ['admin']),
 *  entrada (JSON Schema simples), limitePorMinuto (padrão do nível),
 *  executar(args, contexto) e, para "acao", previa(args, contexto).
 *  dadosPessoais: true quando a saída traz conteúdo de clientes (o MCP esconde essas por padrão).
 */
function definirFerramenta(def) {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(def.nome || '')) throw new Error('Nome de ferramenta inválido: '+def.nome);
  if (!NIVEIS[def.nivel]) throw new Error(`Nível inválido em ${def.nome}: ${def.nivel}`);
  if (typeof def.executar !== 'function') throw new Error(`${def.nome} sem executar()`);
  if (def.nivel === 'acao' && typeof def.previa !== 'function') throw new Error(`${def.nome} é uma ação e precisa de previa()`);
  const perfis = def.perfis || ['admin'];
  if (!perfis.length || perfis.some(p => !PERFIS.includes(p))) throw new Error(`Perfis inválidos em ${def.nome}`);
  const entrada = def.entrada || { type:'object', properties:{} };
  validarEsquema(entrada);
  return Object.freeze({ ...def, perfis, entrada, titulo:def.titulo || def.nome, descricao:def.descricao || '',
    limitePorMinuto:def.limitePorMinuto || NIVEIS[def.nivel].limite });
}

/** Ordena as chaves para que o mesmo pedido gere sempre o mesmo texto. */
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

/**
 * Registro de ferramentas. opcoes: agora() (relógio injetável nos testes) e env (para limpar a saída).
 * Contexto de cada chamada: { usuario:{id,username,role}, origem:'painel'|'local'|'mcp', auditar(acao,ator,detalhe) }.
 * origem "local" (linha de comando no próprio computador) age como administrador, porque quem a executa
 * já tem acesso aos arquivos; acesso remoto sempre exige um usuário com perfil permitido.
 */
function criarRegistro(opcoes = {}) {
  const agora = opcoes.agora || Date.now;
  const env = opcoes.env || process.env;
  const chave = crypto.randomBytes(32); // reinicia a cada processo: códigos antigos deixam de valer
  const ferramentas = new Map();
  const uso = new Map();
  const confirmacoesUsadas = new Map();

  function perfilDe(contexto) {
    if (contexto?.origem === 'local') return 'admin';
    return contexto?.usuario?.role || null;
  }
  function ator(contexto) {
    return contexto?.origem === 'local' ? 'local' : contexto?.usuario?.username || 'desconhecido';
  }
  function autorizar(f, contexto) {
    const perfil = perfilDe(contexto);
    if (!perfil) throw erro(401, 'sem_login', 'É necessário fazer login.');
    if (!f.perfis.includes(perfil)) throw erro(403, 'sem_permissao', 'Seu perfil não pode usar esta ferramenta.');
  }
  function contarUso(f, contexto) {
    const k = `${f.nome}:${ator(contexto)}`, t = agora(), e = uso.get(k);
    const atual = e && t - e.inicio < 60_000 ? { inicio:e.inicio, n:e.n + 1 } : { inicio:t, n:1 };
    uso.set(k, atual);
    if (uso.size > 2000) for (const [kk, v] of uso) if (t - v.inicio > 60_000) uso.delete(kk);
    if (atual.n > f.limitePorMinuto) throw erro(429, 'limite', 'Limite de uso desta ferramenta atingido. Aguarde um minuto.');
  }
  async function auditar(contexto, f, resultado, args) {
    // Só nomes de campos: valores podem conter textos de clientes.
    if (typeof contexto?.auditar === 'function')
      await contexto.auditar(`ferramenta_${f.nome}`, ator(contexto), `${resultado}${Object.keys(args).length ? ' • campos: '+Object.keys(args).join(',') : ''}`);
  }
  function assinatura(nome, contexto, args, expira, nonce) {
    return crypto.createHmac('sha256', chave).update([nome, ator(contexto), canonico(args), expira, nonce].join('|')).digest('base64url');
  }
  function emitirConfirmacao(f, contexto, args) {
    const expira = agora() + CONFIRMACAO_MS, nonce = crypto.randomBytes(9).toString('base64url');
    return { codigo:`${expira}.${nonce}.${assinatura(f.nome, contexto, args, expira, nonce)}`, expiraEm:new Date(expira).toISOString() };
  }
  function conferirConfirmacao(f, contexto, args, codigo) {
    const partes = typeof codigo === 'string' ? codigo.split('.') : [];
    if (partes.length !== 3) throw erro(409, 'confirmacao_invalida', 'Código de confirmação inválido.');
    const [expiraTxt, nonce, sig] = partes, expira = Number(expiraTxt);
    const esperado = Buffer.from(assinatura(f.nome, contexto, args, expira, nonce)), recebido = Buffer.from(sig);
    if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido))
      throw erro(409, 'confirmacao_invalida', 'O código não corresponde a esta ferramenta, a estes argumentos ou a este usuário.');
    if (!(expira > agora())) throw erro(409, 'confirmacao_expirada', 'Código de confirmação expirado. Peça uma nova prévia.');
    if (confirmacoesUsadas.has(nonce)) throw erro(409, 'confirmacao_usada', 'Este código já foi usado.');
    confirmacoesUsadas.set(nonce, expira);
    for (const [n, exp] of confirmacoesUsadas) if (exp <= agora()) confirmacoesUsadas.delete(n);
  }

  return {
    registrar(def) {
      const f = definirFerramenta(def);
      if (ferramentas.has(f.nome)) throw new Error('Ferramenta repetida: '+f.nome);
      ferramentas.set(f.nome, f);
      return this;
    },
    /** Lista só o que o contexto pode usar, com o esquema de entrada (formato pronto para MCP). */
    listar(contexto) {
      const perfil = perfilDe(contexto);
      return [...ferramentas.values()].filter(f => perfil && f.perfis.includes(perfil)).map(f => ({
        nome:f.nome, titulo:f.titulo, descricao:f.descricao, nivel:f.nivel, nivelDescricao:NIVEIS[f.nivel].descricao,
        exigeConfirmacao:f.nivel === 'acao', dadosPessoais:Boolean(f.dadosPessoais), limitePorMinuto:f.limitePorMinuto, entrada:f.entrada }));
    },
    /**
     * Executa. Para "acao": sem `confirmacao` devolve { requerConfirmacao, previa, confirmacao };
     * com o código recebido, executa de fato. Erros têm `status` HTTP e `codigo`.
     */
    async executar(nome, argsBrutos, contexto, confirmacao) {
      const f = ferramentas.get(nome);
      if (!f) throw erro(404, 'nao_encontrada', 'Ferramenta não encontrada.');
      autorizar(f, contexto);
      const args = validarArgs(f.entrada, argsBrutos);
      contarUso(f, contexto);
      if (f.nivel === 'acao' && !confirmacao) {
        const previa = await f.previa(args, contexto);
        return semSegredos({ ferramenta:f.nome, requerConfirmacao:true, previa, confirmacao:emitirConfirmacao(f, contexto, args) }, env);
      }
      if (f.nivel === 'acao') conferirConfirmacao(f, contexto, args, confirmacao);
      try {
        const resultado = await f.executar(args, contexto);
        await auditar(contexto, f, 'ok', args);
        return semSegredos({ ferramenta:f.nome, resultado }, env);
      } catch (err) {
        await auditar(contexto, f, 'falha', args).catch(() => {});
        throw err;
      }
    },
    nomes() { return [...ferramentas.keys()]; },
  };
}

module.exports = { criarRegistro, definirFerramenta, validarArgs, NIVEIS, PERFIS };
