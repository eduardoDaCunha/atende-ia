'use strict';
const crypto = require('node:crypto');
const { read, update } = require('./store');
const sessions = new Map();
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
function passwordValid(password) { return typeof password === 'string' && password.length >= 12 && password.length <= 128; }
function generatePassword() { return crypto.randomBytes(18).toString('base64url') + 'aA1!'; }
function safeUser(user) { return { id:user.id, username:user.username, name:user.name, role:user.role, active:user.active, mustChangePassword:user.mustChangePassword, companyId:user.companyId||null, createdAt:user.createdAt }; }
function sessionKey(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookie(req, name) {
  const all = String(req.headers.cookie || '').split(';');
  const part = all.find(x => x.trim().startsWith(name + '='));
  return part ? part.trim().slice(name.length + 1) : '';
}
function newSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  sessions.set(sessionKey(token), { id:user.id, csrf, created:now, seen:now });
  res.setHeader('Set-Cookie', `atende_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE / 1000}`);
  return csrf;
}
function clearSession(req, res) {
  const token = cookie(req, 'atende_sid');
  if (token) sessions.delete(sessionKey(token));
  res.setHeader('Set-Cookie', 'atende_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}
function revokeUser(id) { for (const [key, value] of sessions) if (value.id === id) sessions.delete(key); }
async function session(req) {
  const token = cookie(req, 'atende_sid');
  if (!token) return null;
  const key = sessionKey(token);
  const s = sessions.get(key);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > MAX_AGE || now - s.seen > IDLE) { sessions.delete(key); return null; }
  const users = await read(USERFILE);
  const user = users.find(u => u.id === s.id && u.active);
  if (!user) { sessions.delete(key); return null; }
  s.seen = now;
  return { user, csrf:s.csrf };
}
function failureKey(username) { return String(username || '').toLowerCase(); }
function locked(username) {
  const key = failureKey(username), v = failures.get(key);
  if (!v) return false;
  if (Date.now() > v.until) { failures.delete(key); return false; }
  return v.count >= 5;
}
function fail(username) {
  const key = failureKey(username), now = Date.now();
  const old = failures.get(key);
  const value = !old || now > old.until ? { count:1, until:now+15*60_000 } : { ...old, count:old.count+1 };
  failures.set(key, value);
  if (failures.size > 1000) for (const [k,v] of failures) if (Date.now()>v.until) failures.delete(k);
}
function forget(username) { failures.delete(failureKey(username)); }
// Apenas o administrador pode consultar/desbloquear pelo servidor; never export passwords or tokens.
function lockInfo(username) {
  const key=failureKey(username), entry=failures.get(key);
  if (!entry) return null;
  if (Date.now()>=entry.until) { failures.delete(key);return null; }
  return entry.count>=5 ? {username:key,attempts:entry.count,until:new Date(entry.until).toISOString()} : null;
}
function blockedAccounts() {
  const result=[];
  for (const key of failures.keys()) { const info=lockInfo(key);if(info)result.push(info); }
  return result.sort((a,b)=>a.until.localeCompare(b.until));
}
function unblock(username) { const existed=Boolean(lockInfo(username));forget(username);return existed; }
module.exports = { hashPassword, verifyPassword, passwordValid, generatePassword, safeUser, newSession, clearSession, revokeUser, session, locked, fail, forget, lockInfo, blockedAccounts, unblock, ROLES, USERFILE };
