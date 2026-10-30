/** Atende.IA — última barreira antes de qualquer saída de ferramenta.
 *  Troca por "[oculto]" valores sensíveis do ambiente (tokens, chaves, telefones,
 *  IDs, hostname privado) e caminhos locais que tenham escapado num resultado.
 */
'use strict';
const os = require('node:os');
const { ROOT, DATA } = require('./store');

const SEGREDOS = ['GEMINI_API_KEY','WHATSAPP_TOKEN','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_EMPRESA_ID','SECURITY_WHATSAPP_TO','TAILSCALE_HOST','ATENDE_DATA_DIR','LOCALAPPDATA','USERPROFILE','HOME'];
const texto = v => typeof v === 'string' ? v.trim() : '';

function valoresSensiveis(env) {
  const valores = new Set();
  for (const nome of SEGREDOS) { const v = texto(env[nome]); if (v.length >= 4) valores.add(v); }
  for (const n of texto(env.WHATSAPP_ALLOWED_NUMBERS).split(',')) { const d = n.replace(/\D/g, ''); if (d.length >= 8) valores.add(d); }
  for (const p of [DATA, ROOT, os.homedir()]) if (p && p.length >= 4) valores.add(p);
  return [...valores].sort((a,b) => b.length - a.length);
}

/** Devolve uma cópia do valor (qualquer JSON) sem os valores sensíveis de `env`. */
function semSegredos(valor, env=process.env) {
  if (valor === undefined) return valor;
  let json = JSON.stringify(valor);
  for (const v of valoresSensiveis(env)) json = json.split(JSON.stringify(v).slice(1,-1)).join('[oculto]');
  return JSON.parse(json);
}

module.exports = { semSegredos, SEGREDOS };
