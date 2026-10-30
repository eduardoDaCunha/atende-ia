/** Atende.IA — ferramentas de leitura do negócio (Task 4).
 *
 *  Só leem: estatísticas, solicitações, conversas do WhatsApp e empresas.
 *  - Listas: administrador vê tudo; atendimento só a própria empresa. Cliente aparece
 *    como iniciais e telefone como ***0001; nenhum texto de mensagem.
 *  - Conteúdo de mensagens: só administrador, nível "sensivel", marcado como
 *    dadosPessoais (o MCP esconde essas ferramentas sem ATENDE_MCP_DADOS_PESSOAIS=1).
 */
'use strict';
const { read } = require('./store');
const conversas = require('./conversas');

const STATUS = ['novo','em_andamento','aguardando_cliente','resolvido'];
const PAGINACAO = {
  pagina:{ type:'integer', minimum:1, maximum:10000, default:1, description:'Página (começa em 1).' },
  porPagina:{ type:'integer', minimum:1, maximum:50, default:20, description:'Itens por página (até 50).' },
};
const ID = { type:'string', pattern:'^[a-f0-9-]{36}$', description:'ID (UUID) obtido na listagem.' };

function erro(status, codigo, mensagem) { return Object.assign(new Error(mensagem), { status, codigo }); }
/** "Maria Fictícia Souza" -> "M. S." (primeira e última inicial). */
function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return null;
  const letras = [partes[0], partes.length > 1 ? partes[partes.length - 1] : null].filter(Boolean).map(p => p[0].toUpperCase() + '.');
  return letras.join(' ');
}
const mascararTelefone = t => t ? '***' + String(t).slice(-4) : null;
const corte = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Perfil e empresa de quem chama. Origem "local" (CLI/MCP) age como administrador. */
function quem(contexto) {
  if (contexto?.origem === 'local') return { role:'admin', companyId:null };
  const u = contexto?.usuario;
  if (!u) throw erro(401, 'sem_login', 'É necessário fazer login.');
  if (u.role !== 'admin' && !u.companyId) throw erro(403, 'sem_empresa', 'Seu usuário não está vinculado a uma empresa.');
  return { role:u.role, companyId:u.companyId || null };
}
const podeVer = (q, item) => q.role === 'admin' || (Boolean(q.companyId) && q.companyId === item.companyId);
function paginar(lista, { pagina, porPagina }) {
  const inicio = (pagina - 1) * porPagina;
  return { itens:lista.slice(inicio, inicio + porPagina), pagina, porPagina, total:lista.length, temMais:inicio + porPagina < lista.length };
}
const recentesPrimeiro = campo => (a, b) => String(b[campo] || '').localeCompare(String(a[campo] || ''));

function registrarFerramentasDeNegocio(registro, { ler = read } = {}) {
  registro.registrar({
    nome:'estatisticas', titulo:'Estatísticas do atendimento', nivel:'leitura', perfis:['admin','atendimento'],
    descricao:'Totais de solicitações por status e de conversas do WhatsApp (robô, humano, pedidos de atendente, janela de 24 h aberta). Só números.',
    async executar(args, contexto) {
      const q = quem(contexto);
      const [reqs, convs] = await Promise.all([ler('solicitacoes.json'), ler(conversas.ARQUIVO)]);
      const minhas = reqs.filter(x => podeVer(q, x)), conv = convs.filter(c => podeVer(q, c));
      const resultado = {
        solicitacoes:{ total:minhas.length, ...Object.fromEntries(STATUS.map(s => [s, minhas.filter(x => x.status === s).length])) },
        whatsapp:{ total:conv.length, robo:conv.filter(c => c.modo === 'robo').length, humano:conv.filter(c => c.modo === 'humano').length,
          pediramAtendente:conv.filter(c => c.pedidoAtendente).length, janelaAberta:conv.filter(c => conversas.janelaAberta(c)).length },
      };
      if (q.role === 'admin') resultado.empresas = { total:(await ler('empresas.json')).length };
      return resultado;
    },
  });

  registro.registrar({
    nome:'listar_solicitacoes', titulo:'Listar solicitações', nivel:'leitura', perfis:['admin','atendimento'],
    descricao:'Solicitações mais recentes primeiro, com filtro de status. Cliente só por iniciais; sem descrição nem mensagens.',
    entrada:{ type:'object', properties:{ status:{ type:'string', enum:STATUS }, ...PAGINACAO } },
    async executar(args, contexto) {
      const q = quem(contexto);
      const lista = (await ler('solicitacoes.json')).filter(x => podeVer(q, x) && (!args.status || x.status === args.status)).sort(recentesPrimeiro('updatedAt'));
      const pag = paginar(lista, args);
      return { ...pag, itens:pag.itens.map(x => ({ id:x.id, assunto:corte(x.subject, 100), status:x.status, prioridade:x.priority,
        cliente:iniciais(x.customerName), responsavel:x.assignedTo || null, mensagens:(x.messages || []).length,
        criadaEm:x.createdAt, atualizadaEm:x.updatedAt })) };
    },
  });

  registro.registrar({
    nome:'ler_solicitacao', titulo:'Ler solicitação completa', nivel:'sensivel', perfis:['admin'], dadosPessoais:true, limitePorMinuto:20,
    descricao:'Descrição e mensagens de uma solicitação, incluindo notas internas (marcadas). Contém dados pessoais: use só quando necessário.',
    entrada:{ type:'object', properties:{ id:ID }, required:['id'] },
    async executar(args, contexto) {
      quem(contexto);
      const x = (await ler('solicitacoes.json')).find(r => r.id === args.id);
      if (!x) throw erro(404, 'nao_encontrada', 'Solicitação não encontrada.');
      return { id:x.id, assunto:x.subject, status:x.status, prioridade:x.priority, cliente:x.customerName, responsavel:x.assignedTo || null,
        criadaEm:x.createdAt, atualizadaEm:x.updatedAt, descricao:x.description,
        mensagens:(x.messages || []).map(m => ({ autor:m.author, papel:m.role, notaInterna:Boolean(m.internal), texto:m.content, em:m.createdAt })) };
    },
  });

  registro.registrar({
    nome:'listar_conversas_whatsapp', titulo:'Listar conversas do WhatsApp', nivel:'leitura', perfis:['admin','atendimento'],
    descricao:'Conversas mais recentes primeiro, com filtros de modo e de pedido de atendente. Telefone mascarado, nome por iniciais, sem texto de mensagens.',
    entrada:{ type:'object', properties:{ modo:{ type:'string', enum:['robo','humano'] }, pediuAtendente:{ type:'boolean' }, ...PAGINACAO } },
    async executar(args, contexto) {
      const q = quem(contexto);
      const lista = (await ler(conversas.ARQUIVO)).filter(c => podeVer(q, c) && (!args.modo || c.modo === args.modo)
        && (args.pediuAtendente === undefined || Boolean(c.pedidoAtendente) === args.pediuAtendente)).sort(recentesPrimeiro('atualizadoEm'));
      const pag = paginar(lista, args);
      return { ...pag, itens:pag.itens.map(c => ({ id:c.id, cliente:iniciais(c.nome), telefone:mascararTelefone(c.telefone), modo:c.modo,
        atendente:c.atendente || null, pediuAtendente:Boolean(c.pedidoAtendente), janelaAberta:conversas.janelaAberta(c),
        mensagens:(c.mensagens || []).length, atualizadaEm:c.atualizadoEm })) };
    },
  });

  registro.registrar({
    nome:'ler_conversa_whatsapp', titulo:'Ler conversa do WhatsApp', nivel:'sensivel', perfis:['admin'], dadosPessoais:true, limitePorMinuto:20,
    descricao:'Mensagens de uma conversa (cliente, robô e atendentes). Telefone continua mascarado. Contém dados pessoais: use só quando necessário.',
    entrada:{ type:'object', properties:{ id:ID, ultimas:{ type:'integer', minimum:1, maximum:300, default:50, description:'Quantas mensagens finais trazer.' } }, required:['id'] },
    async executar(args, contexto) {
      quem(contexto);
      const c = (await ler(conversas.ARQUIVO)).find(x => x.id === args.id);
      if (!c) throw erro(404, 'nao_encontrada', 'Conversa não encontrada.');
      return { id:c.id, cliente:c.nome || null, telefone:mascararTelefone(c.telefone), modo:c.modo, atendente:c.atendente || null,
        janelaAberta:conversas.janelaAberta(c), mensagens:(c.mensagens || []).slice(-args.ultimas).map(m => ({ de:m.de, autor:m.autor, texto:m.texto, em:m.em })) };
    },
  });

  registro.registrar({
    nome:'listar_empresas', titulo:'Listar empresas', nivel:'leitura', perfis:['admin'],
    descricao:'Empresas cadastradas com cidade/UF, situação e plano. Sem contato nem observações internas.',
    entrada:{ type:'object', properties:{ ...PAGINACAO } },
    async executar(args, contexto) {
      quem(contexto);
      const pag = paginar((await ler('empresas.json')).sort(recentesPrimeiro('createdAt')), args);
      return { ...pag, itens:pag.itens.map(e => ({ id:e.id, nome:e.name, cidade:e.city || null, uf:e.uf || null, situacao:e.state || null,
        plano:e.subscription?.plan || null, assinatura:e.subscription?.status || null, criadaEm:e.createdAt || null })) };
    },
  });
}

module.exports = { registrarFerramentasDeNegocio, iniciais, mascararTelefone };
