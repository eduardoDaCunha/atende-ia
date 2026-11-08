/** Atende.IA — aviso ao administrador pelo Telegram quando um chamado de suporte é aberto.
 *
 *  TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID: sem as duas, o aviso fica desligado (não é erro).
 *  Só uma delas ou formato inválido: o aviso também fica desligado e a partida registra uma
 *  linha de log, sem valores. Sem dependências: usa node:https.
 *  Texto puro (sem parse_mode, evita injeção de formatação) e SEM a descrição do chamado.
 *  Falha do Telegram nunca impede gravar o chamado: o log diz só "Aviso do chamado indisponível".
 */
'use strict';
const https = require('node:https');
const { semSegredos } = require('./sanitizar');

const HOST = 'api.telegram.org';
const TIMEOUT_MS = 5_000;
const FORMATO_TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{30,100}$/;
const FORMATO_CHAT = /^-?\d{1,20}$/;

const limpar = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const numeroDo = id => String(id || '').slice(0, 8).toUpperCase();
function quando(iso) {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  return partes.replace(',', '') + ' (horário de Brasília)';
}

/** Texto do aviso. dados: { id, empresa, nome, usuario, criadoEm, assunto, painel }. Nunca recebe a descrição. */
function montarMensagem({ id, empresa, nome, usuario, criadoEm, assunto, painel }) {
  return semSegredos([
    `Novo chamado de suporte #${numeroDo(id)}`,
    `Empresa: ${limpar(empresa, 100) || 'Não informada'}`,
    `Aberto por: ${limpar(nome, 80) || 'Não informado'} (${limpar(usuario, 30)})`,
    `Quando: ${quando(criadoEm)}`,
    `Assunto: ${limpar(assunto, 100)}`,
    `Ver no painel: ${limpar(painel, 200)}`,
  ].join('\n'));
}

/** Lê a configuração. Devolve { ativo, motivo } sem nunca expor os valores. */
function configuracao(env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim(), chat = String(env.TELEGRAM_CHAT_ID || '').trim();
  if (!token && !chat) return { ativo: false, motivo: 'Aviso de chamados por Telegram: desligado (sem TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID).' };
  if (!token || !chat) return { ativo: false, motivo: 'Aviso de chamados por Telegram: DESLIGADO, configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID juntos.' };
  if (!FORMATO_TOKEN.test(token) || !FORMATO_CHAT.test(chat)) return { ativo: false, motivo: 'Aviso de chamados por Telegram: DESLIGADO, formato inválido em TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID.' };
  return { ativo: true, token, chat, motivo: 'Aviso de chamados por Telegram: ligado.' };
}

function enviar(token, chat, texto) {
  return new Promise((resolve, reject) => {
    const corpo = JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true });
    // https.request é lido na hora do envio (não desestruturado): o teste troca por um Telegram falso.
    const req = https.request({ host: HOST, port: 443, method: 'POST', path: `/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corpo) } }, res => {
      res.resume();
      res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error('status'))));
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(corpo);
  });
}

function criarAviso(env = process.env) {
  const cfg = configuracao(env);
  return {
    ativo: cfg.ativo,
    motivo: cfg.motivo,
    /** Nunca rejeita: falhas viram uma linha de log sem token, conteúdo ou nomes. */
    async chamadoAberto(dados) {
      if (!cfg.ativo) return false;
      try { await enviar(cfg.token, cfg.chat, montarMensagem(dados)); return true; }
      catch { console.error('Aviso do chamado indisponível'); return false; }
    },
  };
}

module.exports = { criarAviso, montarMensagem, configuracao, numeroDo };
