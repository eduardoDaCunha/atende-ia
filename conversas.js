/** Atende.IA — conversas do WhatsApp guardadas pelo servidor.
 *  Usa o mesmo store.js (e a mesma fila de gravação) do painel, por isso só pode
 *  ser chamado de dentro do processo do server.js.
 */
'use strict';
const crypto = require('node:crypto');
const { read, update } = require('./store');
const { normalize } = require('./resposta');

const ARQUIVO = 'conversas-whatsapp.json';
const JANELA_MS = 24 * 60 * 60 * 1000; // regra da Meta para responder com texto livre
const MAX_MENSAGENS = 300;
const MAX_CONVERSAS = 2000;

function pedeAtendente(texto) {
  return /\b(atendente|humano|pessoa|falar com alguem|orcamento)\b/.test(normalize(texto));
}
function janelaAberta(c, agora=Date.now()) {
  return Boolean(c.ultimaDoClienteEm) && agora - Date.parse(c.ultimaDoClienteEm) < JANELA_MS;
}
function janelaFechaEm(c) {
  return c.ultimaDoClienteEm ? new Date(Date.parse(c.ultimaDoClienteEm) + JANELA_MS).toISOString() : null;
}
function mensagem(de, texto, autor) {
  return { id:crypto.randomUUID(), de, autor, texto, em:new Date().toISOString() };
}
function guardar(c, m) {
  c.mensagens.push(m);
  if (c.mensagens.length > MAX_MENSAGENS) c.mensagens.splice(0, c.mensagens.length - MAX_MENSAGENS);
  c.atualizadoEm = m.em;
}

/** Mensagem recebida do cliente. Retorna o modo atual (robo ou humano). */
async function registrarEntrada({ from, nome, texto }, companyId) {
  return update(ARQUIVO, list => {
    let c = list.find(x => x.telefone === from);
    if (!c) {
      c = { id:crypto.randomUUID(), telefone:from, nome:nome || '', companyId:companyId || null, modo:'robo', atendente:null,
            pedidoAtendente:false, mensagens:[], criadoEm:new Date().toISOString(), atualizadoEm:null, ultimaDoClienteEm:null };
      list.push(c);
      if (list.length > MAX_CONVERSAS) {
        list.sort((a,b) => (a.atualizadoEm||'').localeCompare(b.atualizadoEm||''));
        list.splice(0, list.length - MAX_CONVERSAS);
      }
    }
    if (nome) c.nome = nome;
    const m = mensagem('cliente', texto, c.nome || 'Cliente');
    guardar(c, m);
    c.ultimaDoClienteEm = m.em;
    if (c.modo === 'robo' && pedeAtendente(texto)) c.pedidoAtendente = true;
    return { modo:c.modo };
  });
}
/** Mensagem enviada ao cliente, pelo robô ou por um atendente. */
async function registrarSaida({ to, texto, de, autor }) {
  await update(ARQUIVO, list => {
    const c = list.find(x => x.telefone === to);
    if (c) guardar(c, mensagem(de, texto, autor || (de === 'robo' ? 'Robô' : 'Atendente')));
  });
}
function resumo(c) {
  const ultima = c.mensagens[c.mensagens.length - 1];
  return { id:c.id, nome:c.nome, telefone:c.telefone, modo:c.modo, atendente:c.atendente, pedidoAtendente:c.pedidoAtendente,
           atualizadoEm:c.atualizadoEm, janelaAberta:janelaAberta(c),
           ultima: ultima ? { de:ultima.de, texto:ultima.texto.slice(0, 120) } : null };
}
function completa(c) {
  return { ...resumo(c), janelaFechaEm:janelaFechaEm(c), mensagens:c.mensagens };
}
async function listar() { return read(ARQUIVO); }
/** Altera uma conversa dentro da fila de gravação; `mudar` pode lançar erro para cancelar. */
async function alterar(id, mudar) {
  return update(ARQUIVO, list => {
    const c = list.find(x => x.id === id);
    return mudar(c);
  });
}

module.exports = { ARQUIVO, registrarEntrada, registrarSaida, resumo, completa, listar, alterar, janelaAberta, pedeAtendente };
