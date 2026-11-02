/** Atende.IA — ponto único de acesso aos dados.
 *
 *  ATENDE_BANCO=json (padrão): arquivos JSON locais, para desenvolvimento no Windows.
 *  ATENDE_BANCO=postgres: PostgreSQL (DATABASE_URL), obrigatório em produção.
 *
 *  As rotas recebem objetos no mesmo formato nos dois motores. O "escopo" vem SEMPRE
 *  do usuário da sessão no servidor ({ perfil, empresaId }), nunca da requisição.
 */
'use strict';
const MOTOR = String(process.env.ATENDE_BANCO || 'json').trim().toLowerCase();
if (!['json', 'postgres'].includes(MOTOR)) throw new Error('ATENDE_BANCO deve ser json ou postgres.');

let instancia = null;
function dados() {
  if (!instancia) instancia = MOTOR === 'postgres' ? require('./postgres').criar(process.env) : require('./json').criar();
  return instancia;
}
/** Escopo de dados a partir do usuário da sessão. */
function escopoDo(user) { return { perfil: user.role, empresaId: user.role === 'admin' ? null : (user.companyId || null) }; }

module.exports = { MOTOR, dados, escopoDo };
