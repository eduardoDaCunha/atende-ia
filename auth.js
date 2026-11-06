'use strict';
const crypto = require('node:crypto');
// Carregado só quando uma sessão é usada: scripts como setup-admin.js usam apenas o hash de senha.
const dados = () => require('./dados').dados();
const failures = new Map();
const MAX_AGE = 8 * 60 * 60_000;
const IDLE = 30 * 60_000;
const ROLES = ['cliente', 'atendimento', 'admin'];
const USERFILE = 'usuarios.json';
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex') };
}
function verifyPassword(password, user) {
  const computed = hashPassword(password, user.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(user.hash, 'hex'));
}
// Login: scrypt assíncrono (não trava o servidor), com no máximo 4 cálculos ao mesmo tempo; os demais esperam na fila.
// As versões síncronas acima ficam para os scripts de linha de comando (CRIAR-ADMIN, RECUPERAR-ADMIN).
const SCRYPT_SIMULTANEOS = 4;
// Fila de espera limitada: lotada, o login é recusado na hora (503) em vez de esperar sem fim.
const SCRYPT_FILA_MAX = 64;
let scryptAtivos = 0;
const scryptFila = [];
function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    const rodar = () => {
      scryptAtivos++;
      crypto.scrypt(password, salt, 64, (err, buf) => {
        scryptAtivos--;
        const proximo = scryptFila.shift();
        if (proximo) proximo();
        err ? reject(err) : resolve(buf);
      });
    };
    if (scryptAtivos < SCRYPT_SIMULTANEOS) return rodar();
    if (scryptFila.length >= SCRYPT_FILA_MAX) return reject(Object.assign(new Error('Fila de verificação de senha cheia.'), { status: 503, code: 'fila_scrypt' }));
    scryptFila.push(rodar);
  });
}
// Usuário inexistente é conferido contra este hash aleatório: o tempo de resposta não revela quem existe.
const HASH_FICTICIO = Object.freeze({ salt: crypto.randomBytes(16).toString('hex'), hash: crypto.randomBytes(64).toString('hex') });
async function verifyPasswordAsync(password, user) {
  const salvo = Buffer.from(String(user?.hash || ''), 'hex');
  const computed = await scryptAsync(String(password), Buffer.from(String(user?.salt || ''), 'hex'));
  return salvo.length === computed.length && crypto.timingSafeEqual(computed, salvo);
}
function passwordValid(password) { return typeof password === 'string' && password.length >= 12 && password.length <= 128; }
function generatePassword() { return crypto.randomBytes(18).toString('base64url') + 'aA1!'; }
// ATENDE_MFA_ADMIN=1 (produção): administrador só usa o painel depois de ativar a verificação em duas etapas.
const MFA_ADMIN = process.env.ATENDE_MFA_ADMIN === '1';
const mfaRequired = user => MFA_ADMIN && user.role === 'admin' && !user.mfaEnabled;
// Nunca devolve hash, salt nem o segredo do autenticador.
function safeUser(user) { return { id:user.id, username:user.username, name:user.name, role:user.role, active:user.active, mustChangePassword:user.mustChangePassword, companyId:user.companyId||null, createdAt:user.createdAt, mfaEnabled:Boolean(user.mfaEnabled), mfaRequired:mfaRequired(user) }; }

// ---------------------------------------------------------------- verificação em duas etapas (TOTP, RFC 6238)
// Código de 6 dígitos que muda a cada 30 s, gerado por qualquer app autenticador.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function deBase32(txt) { let bits = ''; for (const c of String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function newMfaSecret() { return base32(crypto.randomBytes(20)); }
function totp(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', deBase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const lastStep = new Map(); // usuário -> último passo aceito: o mesmo código não serve duas vezes
/** Aceita o código do passo atual ou de um passo vizinho (relógio do celular adiantado/atrasado). */
function verifyTotp(secret, code, userId, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const step = Math.floor(now / 30_000);
  for (const d of [0, -1, 1]) {
    const s = step + d;
    if (s <= (lastStep.get(userId) || 0)) continue;
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(String(code)))) { lastStep.set(userId, s); return true; }
  }
  return false;
}
function otpauthUrl(secret, username) {
  const rotulo = encodeURIComponent('Atende.IA:' + username);
  return `otpauth://totp/${rotulo}?secret=${secret}&issuer=Atende.IA&algorithm=SHA1&digits=6&period=30`;
}
function sessionKey(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookie(req, name) {
  const all = String(req.headers.cookie || '').split(';');
  const part = all.find(x => x.trim().startsWith(name + '='));
  return part ? part.trim().slice(name.length + 1) : '';
}
// Sessões ficam na camada de dados: memória (JSON) ou tabela sessoes (PostgreSQL).
// Só o hash SHA-256 do token é guardado; o token em si vive apenas no cookie.
// Cookie com Secure quando o site está publicado em HTTPS (SITE_ORIGIN).
const SECURE = /^https:/i.test(String(process.env.SITE_ORIGIN || '')) ? '; Secure' : '';
async function newSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  await dados().sessoes.criar(sessionKey(token), { id:user.id, csrf, created:now, seen:now });
  res.setHeader('Set-Cookie', `atende_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE / 1000}${SECURE}`);
  return csrf;
}
async function clearSession(req, res) {
  const token = cookie(req, 'atende_sid');
  if (token) await dados().sessoes.apagar(sessionKey(token));
  res.setHeader('Set-Cookie', `atende_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE}`);
}
async function revokeUser(id) { await dados().sessoes.apagarDoUsuario(id); }
async function session(req) {
  const token = cookie(req, 'atende_sid');
  if (!token || token.length > 100) return null;
  const key = sessionKey(token);
  const s = await dados().sessoes.obter(key);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > MAX_AGE || now - s.seen > IDLE) { await dados().sessoes.apagar(key); return null; }
  const user = await dados().usuarios.obter(s.id);
  if (!user || !user.active) { await dados().sessoes.apagar(key); return null; }
  // Grava o "visto por último" no máximo a cada minuto, para não escrever a cada requisição.
  if (now - s.seen > 60_000) await dados().sessoes.tocar(key, now);
  return { user, csrf:s.csrf };
}
// Bloqueio por usuário + IP: 5 erros do mesmo IP travam só esse IP por 15 min. Assim ninguém
// de fora trava o login do dono, que entra normalmente de outro IP. Contra ataque espalhado por
// muitos IPs, o total de erros do usuário gera um atraso progressivo (nunca um bloqueio total).
// Tudo fica só na memória; o IP nunca vai para o disco nem para a lista do painel.
const LIMITE_POR_IP = 5, JANELA_BLOQUEIO = 15 * 60_000, ATRASO_A_PARTIR = 10, ATRASO_MAX = 4000;
const errosDoUsuario = new Map();
function failureKey(username, ip) { return String(username || '').toLowerCase() + '\n' + String(ip || ''); }
function userOf(key) { return key.split('\n')[0]; }
function limpar(tabela) { if (tabela.size > 1000) for (const [k,v] of tabela) if (Date.now()>v.until) tabela.delete(k); }
function contar(tabela, key) {
  const now = Date.now(), old = tabela.get(key);
  tabela.set(key, !old || now > old.until ? { count:1, until:now+JANELA_BLOQUEIO } : { ...old, count:old.count+1 });
  limpar(tabela);
}
function locked(username, ip) {
  const key = failureKey(username, ip), v = failures.get(key);
  if (!v) return false;
  if (Date.now() > v.until) { failures.delete(key); return false; }
  return v.count >= LIMITE_POR_IP;
}
function fail(username, ip) { contar(failures, failureKey(username, ip)); contar(errosDoUsuario, String(username || '').toLowerCase()); }
// Atraso (ms) antes de responder: 0 até 9 erros do usuário em 15 min; depois 500, 1000, 2000, 4000 (máximo).
function loginDelay(username) {
  const key = String(username || '').toLowerCase(), v = errosDoUsuario.get(key);
  if (!v) return 0;
  if (Date.now() > v.until) { errosDoUsuario.delete(key); return 0; }
  return v.count < ATRASO_A_PARTIR ? 0 : Math.min(ATRASO_MAX, 500 * 2 ** (v.count - ATRASO_A_PARTIR));
}
// Acerto: limpa só o IP de quem acertou. Os bloqueios de outros IPs (o atacante) continuam.
function forget(username, ip) { failures.delete(failureKey(username, ip)); }
// Apenas o administrador pode consultar/desbloquear pelo servidor; never export passwords or tokens.
// Visão por conta (soma dos IPs bloqueados), sem expor IP.
function lockInfo(username) {
  const user = String(username || '').toLowerCase(), now = Date.now();
  let attempts = 0, until = 0;
  for (const [key, entry] of failures) {
    if (userOf(key) !== user) continue;
    if (now >= entry.until) { failures.delete(key); continue; }
    if (entry.count >= LIMITE_POR_IP) { attempts += entry.count; until = Math.max(until, entry.until); }
  }
  return until ? {username:user,attempts,until:new Date(until).toISOString()} : null;
}
function blockedAccounts() {
  const result=[];
  for (const user of new Set([...failures.keys()].map(userOf))) { const info=lockInfo(user);if(info)result.push(info); }
  return result.sort((a,b)=>a.until.localeCompare(b.until));
}
function unblock(username) {
  const user = String(username || '').toLowerCase(), existed = Boolean(lockInfo(user));
  for (const key of [...failures.keys()]) if (userOf(key) === user) failures.delete(key);
  errosDoUsuario.delete(user);
  return existed;
}
module.exports = { MFA_ADMIN, mfaRequired, newMfaSecret, verifyTotp, totp, otpauthUrl, hashPassword, verifyPassword, verifyPasswordAsync, HASH_FICTICIO, passwordValid, generatePassword, safeUser, newSession, clearSession, revokeUser, session, locked, fail, loginDelay, forget, lockInfo, blockedAccounts, unblock, ROLES, USERFILE };
