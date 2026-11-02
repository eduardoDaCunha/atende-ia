/** Atende.IA — motor de dados em arquivos JSON (desenvolvimento local no Windows).
 *
 *  Reproduz o comportamento original do protótipo: os mesmos arquivos, no mesmo formato,
 *  com a fila de gravação do store.js. Sessões ficam na memória do processo.
 *  Não use em produção: veja dados/postgres.js.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { read, update, DATA } = require('../store');

const ARQ = {
  usuarios: 'usuarios.json', empresas: 'empresas.json', solicitacoes: 'solicitacoes.json',
  conversas: 'conversas-whatsapp.json', auditoria: 'auditoria.json', tentativas: 'tentativas-login.json',
  orcamento: 'leads-demonstracao.json', comercial: 'interesses-comerciais-teste.json', configuracoes: 'configuracoes-agente.json',
};
const MAX_AUDITORIA = 1500, MAX_TENTATIVAS = 700, MAX_MENSAGENS_WPP = 300, MAX_CONVERSAS = 2000;
const agora = () => new Date().toISOString();
const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normalizar = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Escopo vindo da sessão: admin vê tudo; os demais, só a própria empresa. */
const daEmpresa = (escopo, item) => !escopo || escopo.perfil === 'admin' || (Boolean(escopo.empresaId) && escopo.empresaId === item.companyId);

function criar() {
  const sessoes = new Map();
  return {
    motor: 'json',
    async iniciar() {},
    async encerrar() {},
    async saude() { return { motor: 'json', descricao: 'Arquivos JSON locais; backup manual necessário' }; },

    usuarios: {
      listar: () => read(ARQ.usuarios),
      async obter(id) { return (await read(ARQ.usuarios)).find(u => u.id === id) || null; },
      async contaAtiva(usuario) { return (await read(ARQ.usuarios)).find(u => u.username === usuario && u.active) || null; },
      /** Altera a lista inteira dentro da trava; `mudar` pode lançar erro para cancelar. */
      atualizarLista: mudar => update(ARQ.usuarios, mudar),
    },

    empresas: {
      listar: () => read(ARQ.empresas),
      async obter(id) { return (await read(ARQ.empresas)).find(e => e.id === id) || null; },
      atualizarLista: mudar => update(ARQ.empresas, mudar),
    },

    solicitacoes: {
      /** Filtros: { donoId, situacao, busca }. Devolve itens completos, do mais recente para o mais antigo. */
      async listar(escopo, { donoId, situacao, busca } = {}) {
        const b = busca ? normalizar(busca) : '';
        const lista = (await read(ARQ.solicitacoes)).filter(x => daEmpresa(escopo, x)
          && (!donoId || x.ownerId === donoId) && (!situacao || x.status === situacao)
          && (!b || normalizar([x.subject, x.customerName, x.description, x.id].join(' ')).includes(b)));
        return lista.sort((a, b2) => String(b2.updatedAt).localeCompare(String(a.updatedAt)));
      },
      async obter(escopo, id) { const x = (await read(ARQ.solicitacoes)).find(r => r.id === id); return x && daEmpresa(escopo, x) ? x : null; },
      async contar(escopo) {
        const lista = (await read(ARQ.solicitacoes)).filter(x => daEmpresa(escopo, x));
        const r = { total: lista.length };
        for (const s of ['novo', 'em_andamento', 'aguardando_cliente', 'resolvido']) r[s] = lista.filter(x => x.status === s).length;
        return r;
      },
      async existeDoCliente(clienteId) { return (await read(ARQ.solicitacoes)).some(x => x.ownerId === clienteId); },
      criar: item => update(ARQ.solicitacoes, list => { list.push(item); }),
      /** `mudar(item)` recebe a solicitação (ou undefined) e só pode alterar campos e ACRESCENTAR mensagens. */
      alterar: (escopo, id, mudar) => update(ARQ.solicitacoes, list => {
        const x = list.find(r => r.id === id);
        return mudar(x && daEmpresa(escopo, x) ? x : undefined);
      }),
    },

    conversas: {
      /** Mensagem do cliente. Devolve { modo, duplicada }. */
      registrarEntrada: ({ telefone, nome, texto: t, idMeta, pedeAtendente }, empresaId) => update(ARQ.conversas, list => {
        let c = list.find(x => x.telefone === telefone);
        if (c && idMeta && c.mensagens.some(m => m.idMeta === idMeta)) return { modo: c.modo, duplicada: true };
        if (!c) {
          c = { id: crypto.randomUUID(), telefone, nome: nome || '', companyId: empresaId || null, modo: 'robo', atendente: null,
            pedidoAtendente: false, mensagens: [], criadoEm: agora(), atualizadoEm: null, ultimaDoClienteEm: null };
          list.push(c);
          if (list.length > MAX_CONVERSAS) {
            list.sort((a, b) => (a.atualizadoEm || '').localeCompare(b.atualizadoEm || ''));
            list.splice(0, list.length - MAX_CONVERSAS);
          }
        }
        if (nome) c.nome = nome;
        const m = { id: crypto.randomUUID(), de: 'cliente', autor: c.nome || 'Cliente', texto: t, em: agora(), ...(idMeta ? { idMeta } : {}) };
        guardar(c, m);
        c.ultimaDoClienteEm = m.em;
        if (c.modo === 'robo' && pedeAtendente) c.pedidoAtendente = true;
        return { modo: c.modo, duplicada: false };
      }),
      registrarSaida: ({ telefone, texto: t, de, autor }) => update(ARQ.conversas, list => {
        const c = list.find(x => x.telefone === telefone);
        if (c) guardar(c, { id: crypto.randomUUID(), de, autor: autor || (de === 'robo' ? 'Robô' : 'Atendente'), texto: t, em: agora() });
      }),
      async listar(escopo) {
        return (await read(ARQ.conversas)).filter(c => daEmpresa(escopo, c))
          .sort((a, b) => (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));
      },
      async obter(escopo, id) { const c = (await read(ARQ.conversas)).find(x => x.id === id); return c && daEmpresa(escopo, c) ? c : null; },
      /** Só para modo, atendente e pedidoAtendente. */
      alterar: (escopo, id, mudar) => update(ARQ.conversas, list => {
        const c = list.find(x => x.id === id);
        return mudar(c && daEmpresa(escopo, c) ? c : undefined);
      }),
    },

    auditoria: {
      registrar: (action, actor, detail = '') => update(ARQ.auditoria, list => {
        list.push({ at: agora(), action, actor, detail: texto(String(detail), 200) });
        if (list.length > MAX_AUDITORIA) list.splice(0, list.length - MAX_AUDITORIA);
      }),
      async recentes(n = 100) { return (await read(ARQ.auditoria)).slice(-n).reverse(); },
    },

    tentativas: {
      registrar: ({ username, result, reason }) => update(ARQ.tentativas, items => {
        items.push({ at: agora(), username: texto(username, 30).toLowerCase(), result, reason: texto(reason, 110) });
        if (items.length > MAX_TENTATIVAS) items.splice(0, items.length - MAX_TENTATIVAS);
      }),
      /** Em ordem cronológica, como no arquivo. */
      async listar() { return read(ARQ.tentativas); },
    },

    contatos: {
      /** tipo: 'orcamento' | 'comercial'. */
      criar: (tipo, item) => update(tipo === 'orcamento' ? ARQ.orcamento : ARQ.comercial, list => { list.push(item); }),
      async listar() {
        const [orc, com] = await Promise.all([read(ARQ.orcamento), read(ARQ.comercial)]);
        return [...orc.map(x => ({ ...x, kind: 'orçamento (teste)' })), ...com.map(x => ({ ...x, kind: 'comercial (teste)' }))];
      },
    },

    configuracoes: {
      /** empresaId null = site público (empresa.json, como sempre). Empresas: configuracoes-agente.json. */
      async obter(empresaId = null) {
        if (empresaId) return (await read(ARQ.configuracoes, {}))[empresaId] || null;
        try { return JSON.parse(await fs.readFile(path.join(DATA, 'empresa.json'), 'utf8')); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      },
      async salvar(empresaId, cfg) {
        if (empresaId) return update(ARQ.configuracoes, mapa => { mapa[empresaId] = cfg; }, {});
        await fs.mkdir(DATA, { recursive: true });
        const alvo = path.join(DATA, 'empresa.json'), temp = alvo + '.tmp';
        await fs.writeFile(temp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
        await fs.rename(temp, alvo);
      },
    },

    sessoes: {
      async criar(chave, s) { sessoes.set(chave, { ...s }); },
      async obter(chave) { const s = sessoes.get(chave); return s ? { ...s } : null; },
      async tocar(chave, visto) { const s = sessoes.get(chave); if (s) s.seen = visto; },
      async apagar(chave) { sessoes.delete(chave); },
      async apagarDoUsuario(id) { for (const [k, v] of sessoes) if (v.id === id) sessoes.delete(k); },
    },

    /** Leitura em lote no formato dos arquivos (ferramentas de negócio e MCP). */
    lerColecao(nome) {
      const mapa = { 'solicitacoes.json': ARQ.solicitacoes, 'conversas-whatsapp.json': ARQ.conversas, 'empresas.json': ARQ.empresas };
      if (!mapa[nome]) throw new Error('Coleção desconhecida: ' + nome);
      return read(mapa[nome]);
    },
  };
}
function guardar(c, m) {
  c.mensagens.push(m);
  if (c.mensagens.length > MAX_MENSAGENS_WPP) c.mensagens.splice(0, c.mensagens.length - MAX_MENSAGENS_WPP);
  c.atualizadoEm = m.em;
}

module.exports = { criar };
