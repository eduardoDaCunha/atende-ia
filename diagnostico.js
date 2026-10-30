/** Atende.IA — diagnóstico do sistema, somente leitura.
 *
 *  Uso: `node diagnostico.js` (texto), `--json` (para automação/MCP) e
 *  `--testar-conexoes` (consultas gratuitas de leitura à Google e à Meta).
 *  Também atende a rota administrativa /api/admin/diagnostico do server.js.
 *
 *  Garantias: não lê config-local.bat nem arquivos da pasta de dados (só checa
 *  permissão de escrita da pasta), não mostra tokens, telefones, mensagens ou
 *  caminhos, não envia mensagens, não faz chamadas pagas e não altera a rede.
 *  Sem --testar-conexoes, só conversa com 127.0.0.1.
 *
 *  Cada item separa `configurado` (a configuração existe e é válida) de
 *  `conexao` (se uma conexão foi de fato testada e o resultado).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, DATA } = require('./store');
const whatsapp = require('./whatsapp');
const { semSegredos } = require('./sanitizar');

const VERSAO = '0.3.8.3';
const ESQUEMA = 1;
const LOCAL = '127.0.0.1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const TEMPO_LIMITE = 5000;

/** Um item do relatório. estado: ok | aviso | falha | info. conexao: testada_ok | testada_falha | nao_testada | nao_aplicavel. */
function item(id, area, titulo, estado, { configurado=null, conexao='nao_aplicavel', detalhe='' } = {}) {
  return { id, area, titulo, estado, configurado, conexao, detalhe };
}
const texto = v => typeof v === 'string' ? v.trim() : '';

async function consultar(fetchFn, url, init={}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TEMPO_LIMITE);
  try { return await fetchFn(url, { ...init, method:'GET', signal:controller.signal }); }
  finally { clearTimeout(timer); }
}

// ---------- servidor ----------
async function servidor(env, opcoes, fetchFn) {
  const itens = [];
  const node = Number(process.versions.node.split('.')[0]);
  itens.push(item('servidor.versao','servidor','Versão',node >= 22 ? 'info' : 'aviso',{
    detalhe:`Atende.IA ${VERSAO} • Node.js ${process.versions.node}${node >= 22 ? '' : ' (recomendado 22 ou superior)'}`}));

  if (opcoes.dentroDoServidor) {
    const minutos = Math.floor(process.uptime() / 60);
    itens.push(item('servidor.disponibilidade','servidor','Disponibilidade','ok',{configurado:true,conexao:'testada_ok',
      detalhe:`Respondendo (relatório gerado pelo próprio servidor, ativo há ${minutos} min).`}));
  } else {
    const porta = Number(env.PORT || 3011);
    try {
      const r = await consultar(fetchFn, `http://${LOCAL}:${porta}/api/status`, { headers:{ Accept:'application/json' } });
      const corpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const mesma = corpo?.version === VERSAO;
      itens.push(item('servidor.disponibilidade','servidor','Disponibilidade',mesma ? 'ok' : 'aviso',{configurado:true,conexao:'testada_ok',
        detalhe: mesma ? `Respondendo em ${LOCAL}:${porta}.` : `Respondendo em ${LOCAL}:${porta}, mas com outra versão (${texto(String(corpo?.version||'desconhecida')).slice(0,20)}).`}));
    } catch {
      itens.push(item('servidor.disponibilidade','servidor','Disponibilidade','falha',{configurado:true,conexao:'testada_falha',
        detalhe:`Nada respondeu em ${LOCAL}:${porta}. O servidor está desligado ou usa outra porta.`}));
    }
  }

  itens.push(item('servidor.exposicao','servidor','Exposição de rede','ok',{configurado:true,
    detalhe:'O painel escuta somente em 127.0.0.1 (fixo no código).'}));
  const tail = texto(env.TAILSCALE_HOST).toLowerCase();
  if (!tail) itens.push(item('servidor.tailscale','servidor','Acesso Tailscale','info',{configurado:false,detalhe:'Desativado.'}));
  else if (/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(tail)) itens.push(item('servidor.tailscale','servidor','Acesso Tailscale','ok',{configurado:true,conexao:'nao_testada',detalhe:'Hostname privado configurado (não exibido).'}));
  else itens.push(item('servidor.tailscale','servidor','Acesso Tailscale','falha',{configurado:false,detalhe:'TAILSCALE_HOST com formato inválido: o servidor não inicia assim.'}));
  if (texto(env.SITE_ORIGIN)) itens.push(item('servidor.publicacao','servidor','Modo publicação','aviso',{configurado:true,
    detalhe:'SITE_ORIGIN definido: metadados públicos ligados. Este protótipo não deve ser publicado.'}));
  return itens;
}

// ---------- IA ----------
async function ia(env, opcoes, fetchFn) {
  const chave = texto(env.GEMINI_API_KEY), modelo = texto(env.GEMINI_MODEL) || 'gemini-2.5-flash';
  if (!chave) return [item('ia.modo','ia','Inteligência artificial','info',{configurado:false,
    detalhe:'Modo demonstração: respostas programadas, sem custo. Defina GEMINI_API_KEY para usar a IA.'})];
  const formato = chave.length >= 20 && !/\s/.test(chave);
  const base = item('ia.modo','ia','Inteligência artificial',formato ? 'ok' : 'aviso',{configurado:formato,conexao:'nao_testada',
    detalhe: formato ? `Gemini configurado (modelo ${modelo.slice(0,60)}). Conexão não testada.` : 'GEMINI_API_KEY presente, mas com formato improvável.'});
  if (!opcoes.testarConexoes || !formato) return [base];
  // Consulta de metadados do modelo: gratuita, não gera texto nem consome tokens.
  try {
    const r = await consultar(fetchFn, `${opcoes.geminiBase || GEMINI_BASE}/v1beta/models/${encodeURIComponent(modelo)}`, { headers:{ 'x-goog-api-key':chave } });
    if (r.ok) return [{ ...base, conexao:'testada_ok', detalhe:`Gemini respondeu: chave aceita e modelo ${modelo.slice(0,60)} disponível.` }];
    const motivo = r.status === 404 ? 'modelo não encontrado' : [400,401,403].includes(r.status) ? 'chave recusada' : `HTTP ${r.status}`;
    return [{ ...base, estado:'falha', conexao:'testada_falha', detalhe:`Gemini recusou: ${motivo}.` }];
  } catch {
    return [{ ...base, estado:'falha', conexao:'testada_falha', detalhe:'Sem resposta do Gemini (rede ou tempo esgotado).' }];
  }
}

// ---------- WhatsApp ----------
async function canalWhatsapp(env, opcoes, fetchFn) {
  let cfg;
  try { cfg = whatsapp.loadConfig(env); }
  catch (err) {
    // As mensagens de loadConfig citam só nomes de variáveis, nunca valores.
    return { cfg:null, itens:[item('whatsapp.config','whatsapp','WhatsApp','falha',{configurado:false,detalhe:err.message})] };
  }
  if (!cfg) return { cfg:null, itens:[item('whatsapp.config','whatsapp','WhatsApp','info',{configurado:false,detalhe:'Desativado.'})] };

  const itens = [item('whatsapp.config','whatsapp','WhatsApp','ok',{configurado:true,
    detalhe:`Configurado (Graph ${cfg.graphVersion}, webhook na porta ${cfg.port}). Conversas ${cfg.companyId ? 'vinculadas a uma empresa' : 'visíveis só para administradores (sem WHATSAPP_EMPRESA_ID)'}.`})];
  itens.push(cfg.allowed.length
    ? item('whatsapp.numeros','whatsapp','Números autorizados','ok',{configurado:true,detalhe:`Restrito a ${cfg.allowed.length} número(s) (não exibidos).`})
    : item('whatsapp.numeros','whatsapp','Números autorizados','aviso',{configurado:false,detalhe:'Sem WHATSAPP_ALLOWED_NUMBERS: qualquer número que escrever recebe resposta.'}));

  // Webhook local: GET sem token deve responder 403. Nada sai do computador.
  try {
    const r = await consultar(fetchFn, `http://${LOCAL}:${cfg.port}${whatsapp.ROUTE}`);
    itens.push(r.status === 403
      ? item('whatsapp.webhook','whatsapp','Webhook local','ok',{configurado:true,conexao:'testada_ok',detalhe:`Escutando em ${LOCAL}:${cfg.port} e recusando pedidos sem token.`})
      : item('whatsapp.webhook','whatsapp','Webhook local','aviso',{configurado:true,conexao:'testada_falha',detalhe:`A porta ${cfg.port} respondeu HTTP ${r.status}, não o esperado (403).`}));
  } catch {
    itens.push(item('whatsapp.webhook','whatsapp','Webhook local','falha',{configurado:true,conexao:'testada_falha',
      detalhe:`Nada escutando em ${LOCAL}:${cfg.port}. O webhook sobe junto com o servidor.`}));
  }

  const meta = item('whatsapp.meta','whatsapp','Conexão com a Meta','info',{configurado:true,conexao:'nao_testada',
    detalhe:'Não testada. O token temporário da Meta expira em 24 h; use --testar-conexoes para conferir.'});
  if (!opcoes.testarConexoes) itens.push(meta);
  else {
    // Leitura do próprio número (só o campo id): gratuita, não envia mensagem. O corpo não é exibido.
    try {
      const r = await consultar(fetchFn, `${cfg.graphBase}/${cfg.graphVersion}/${cfg.phoneNumberId}?fields=id`, { headers:{ Authorization:`Bearer ${cfg.token}` } });
      if (r.ok) itens.push({ ...meta, estado:'ok', conexao:'testada_ok', detalhe:'A Meta aceitou o token e reconheceu o número configurado.' });
      else itens.push({ ...meta, estado:'falha', conexao:'testada_falha',
        detalhe: [401,403].includes(r.status) ? 'A Meta recusou o token (inválido ou expirado).' : r.status === 400 || r.status === 404 ? 'A Meta não reconheceu WHATSAPP_PHONE_NUMBER_ID.' : `A Meta respondeu HTTP ${r.status}.` });
    } catch {
      itens.push({ ...meta, estado:'falha', conexao:'testada_falha', detalhe:'Sem resposta da Meta (rede ou tempo esgotado).' });
    }
  }
  itens.push(item('whatsapp.publicacao','whatsapp','Publicação do app na Meta','info',{conexao:'nao_aplicavel',
    detalhe:'Não verificável daqui. Com o app não publicado, mensagens reais de clientes não chegam.'}));
  return { cfg, itens };
}

// ---------- alertas de segurança ----------
function alertas(env, cfgWhatsapp) {
  const ligado = texto(env.SECURITY_WHATSAPP_ENABLED) === '1';
  if (!ligado) return [item('seguranca.alertas','seguranca','Alertas de segurança pelo WhatsApp','info',{configurado:false,
    detalhe:'Desativados (padrão).'})];
  const faltas = [];
  if (!cfgWhatsapp) faltas.push('integração WhatsApp (WHATSAPP_*)');
  if (!/^55\d{11}$/.test(texto(env.SECURITY_WHATSAPP_TO))) faltas.push('SECURITY_WHATSAPP_TO válido');
  if (!texto(env.SECURITY_WHATSAPP_TEMPLATE)) faltas.push('SECURITY_WHATSAPP_TEMPLATE');
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(texto(env.SECURITY_WHATSAPP_LANGUAGE) || 'pt_BR')) faltas.push('SECURITY_WHATSAPP_LANGUAGE válido');
  return [faltas.length
    ? item('seguranca.alertas','seguranca','Alertas de segurança pelo WhatsApp','falha',{configurado:false,detalhe:'Ligados, mas falta: '+faltas.join(', ')+'.'})
    : item('seguranca.alertas','seguranca','Alertas de segurança pelo WhatsApp','ok',{configurado:true,conexao:'nao_testada',
        detalhe:'Ligados e configurados (destinatário não exibido). Não testados: testar exigiria enviar uma mensagem.'})];
}

// ---------- segurança local ----------
function segurancaLocal() {
  const itens = [
    item('seguranca.login','seguranca','Proteção de login','ok',{configurado:true,detalhe:'Bloqueio por conta após 5 erros (~15 min) e histórico de tentativas.'}),
    item('seguranca.csrf','seguranca','Proteção de formulários','ok',{configurado:true,detalhe:'CSRF e checagem de origem em todas as ações do painel.'}),
  ];
  // Só permissões e posição da pasta: nenhum arquivo de dados é aberto.
  const dentroDoProjeto = !path.relative(ROOT, DATA).startsWith('..') && !path.isAbsolute(path.relative(ROOT, DATA));
  let gravavel = false, existe = false;
  try { existe = fs.statSync(DATA).isDirectory(); fs.accessSync(DATA, fs.constants.W_OK); gravavel = existe; } catch {}
  itens.push(!existe
    ? item('seguranca.dados','seguranca','Pasta de dados','aviso',{configurado:false,detalhe:'Pasta de dados ainda não existe (é criada no primeiro uso).'})
    : !gravavel
      ? item('seguranca.dados','seguranca','Pasta de dados','falha',{configurado:true,detalhe:'Sem permissão de escrita na pasta de dados.'})
      : item('seguranca.dados','seguranca','Pasta de dados',dentroDoProjeto ? 'aviso' : 'ok',{configurado:true,
          detalhe: dentroDoProjeto ? 'Gravável, mas dentro da pasta do projeto (risco de versionar dados).' : 'Gravável e fora da pasta do projeto (caminho não exibido).'}));
  let ignorado = false;
  try { ignorado = /^config-local\.bat$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')); } catch {}
  itens.push(item('seguranca.gitignore','seguranca','Segredos fora do Git',ignorado ? 'ok' : 'falha',{configurado:ignorado,
    detalhe: ignorado ? 'config-local.bat está no .gitignore.' : 'config-local.bat não está no .gitignore: risco de publicar segredos.'}));
  return itens;
}

const LIMITACOES = [
  item('limite.sessoes','limitacoes','Sessões','info',{detalhe:'Ficam na memória: reiniciar o servidor desconecta todos.'}),
  item('limite.armazenamento','limitacoes','Armazenamento','info',{detalhe:'Arquivos JSON locais, sem backup automático.'}),
  item('limite.monitoramento','limitacoes','Monitoramento','info',{detalhe:'Não há monitoramento externo: se o processo cair, nada avisa.'}),
  item('limite.diagnostico','limitacoes','Este diagnóstico','info',{detalhe:'Lê só as variáveis do processo que o executa. Rodado num terminal sem o config-local.bat, mostra integrações como desativadas; o relatório do painel admin reflete o servidor em execução.'}),
];

/**
 * Gera o relatório. opcoes: env, dentroDoServidor, testarConexoes, fetch (injetável nos testes), geminiBase (só testes).
 * Retorna { esquema, versao, geradoEm, resumo, itens } — JSON simples, pronto para uma ferramenta MCP.
 */
async function coletarDiagnostico(opcoes = {}) {
  const env = opcoes.env || process.env, fetchFn = opcoes.fetch || fetch;
  const { cfg, itens:itensWhatsapp } = await canalWhatsapp(env, opcoes, fetchFn);
  const itens = [
    ...await servidor(env, opcoes, fetchFn),
    ...await ia(env, opcoes, fetchFn),
    ...itensWhatsapp,
    ...alertas(env, cfg),
    ...segurancaLocal(),
    ...LIMITACOES,
  ];
  const contagem = { ok:0, aviso:0, falha:0, info:0 };
  for (const i of itens) contagem[i.estado]++;
  const geral = contagem.falha ? 'falha' : contagem.aviso ? 'aviso' : 'ok';
  return semSegredos({ esquema:ESQUEMA, versao:VERSAO, geradoEm:new Date().toISOString(),
    conexoesExternasTestadas:Boolean(opcoes.testarConexoes), resumo:{ geral, ...contagem }, itens }, env);
}

function formatarTexto(r) {
  const simbolo = { ok:'[OK]   ', aviso:'[AVISO]', falha:'[FALHA]', info:'[INFO] ' };
  const conexao = { testada_ok:'conexão testada: ok', testada_falha:'conexão testada: falhou', nao_testada:'conexão não testada', nao_aplicavel:'' };
  const linhas = [`Atende.IA ${r.versao} — diagnóstico (${new Date(r.geradoEm).toLocaleString('pt-BR')})`,
    `Resultado geral: ${r.resumo.geral.toUpperCase()} • ${r.resumo.ok} ok, ${r.resumo.aviso} aviso(s), ${r.resumo.falha} falha(s)`,
    r.conexoesExternasTestadas ? 'Conexões externas testadas (somente leituras gratuitas).' : 'Conexões externas NÃO testadas (use --testar-conexoes).', ''];
  let area = '';
  for (const i of r.itens) {
    if (i.area !== area) { area = i.area; linhas.push(`== ${area.toUpperCase()}`); }
    const extra = [i.configurado === null ? '' : i.configurado ? 'configurado' : 'não configurado', conexao[i.conexao]].filter(Boolean).join(' • ');
    linhas.push(`${simbolo[i.estado]} ${i.titulo}: ${i.detalhe}${extra ? ` (${extra})` : ''}`);
  }
  return linhas.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  coletarDiagnostico({ testarConexoes:args.has('--testar-conexoes') })
    .then(r => { console.log(args.has('--json') ? JSON.stringify(r, null, 2) : formatarTexto(r)); process.exitCode = r.resumo.falha ? 1 : 0; })
    .catch(err => { console.error('Falha no diagnóstico:', err.message); process.exitCode = 2; });
}
module.exports = { coletarDiagnostico, formatarTexto, VERSAO, ESQUEMA };
