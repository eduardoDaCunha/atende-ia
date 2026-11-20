#!/usr/bin/env node
'use strict';
// Hook PreToolUse do Claude Code: recusa, antes de acontecer, leitura de segredos, acesso a
// servidor/nuvem e git que altera o repositorio. Codigo 2 = bloqueado (motivo no stderr),
// codigo 0 = segue o fluxo normal de permissoes. Falha fechada: qualquer erro bloqueia.
// So usa fs e path. Nunca escreve o comando nem o caminho na saida, so a categoria.
// Filtro de texto: protege contra erro e curiosidade, nao contra quem quer burlar (ver SEGURANCA.md).
const fs = require('fs');
const path = require('path');

const CAT = {
  segredo: 'arquivo de segredo',
  chave: 'chave ou certificado',
  pasta: 'pasta de credenciais',
  dados: 'dados reais',
  hook: 'configuracao do hook',
  ambiente: 'variaveis de ambiente',
  docker: 'docker que expoe segredos',
  servidor: 'acesso a servidor ou nuvem',
  git: 'git que altera o repositorio',
  entrada: 'entrada ilegivel ou erro interno do hook'
};

const FERRAMENTAS_ARQUIVO = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob', 'Artifact']);
const FERRAMENTAS_ESCRITA = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FERRAMENTAS_SHELL = new Set(['Bash', 'PowerShell']);

// ---------- Nomes sensiveis (um segmento de caminho ou uma palavra do comando) ----------

// Windows ignora pontos e espacos no fim do nome: ".env." e ".env " sao o ".env".
function limparNome(s) {
  if (s === '.' || s === '..') return s;
  const t = s.replace(/[. ]+$/, '');
  return t || s;
}

function categoriaNome(nomeOriginal) {
  const n = limparNome(String(nomeOriginal).toLowerCase());
  if (!n) return null;
  if (n === '.env' || (n.startsWith('.env.') && n !== '.env.exemplo' && n !== '.env.example')) return CAT.segredo;
  if (n === 'config-local.bat' || n === 'rclone.conf') return CAT.segredo;
  if (/\.(pem|key|p12|pfx|ppk)$/.test(n)) return CAT.chave;
  if (/^(id_rsa|id_ed25519|id_ecdsa|atende_deploy)/.test(n)) return CAT.chave;
  if (n === 'known_hosts' || n === 'authorized_keys') return CAT.chave;
  if (n === '.ssh' || n === '.aws' || n === '.gnupg') return CAT.pasta;
  if (n === 'usuarios.json' || n === 'solicitacoes.json' || /^sessoes.*\.json$/.test(n)) return CAT.dados;
  if (/\.(sqlite|db|dump|bak)$/.test(n)) return CAT.dados;
  return null;
}

// ---------- Caminhos (ferramentas de arquivo) ----------

function barras(s) { return String(s).replace(/\\/g, '/'); }

// Raizes do projeto: a pasta "data" so conta na raiz (ou em ...\AtendeIA\data).
function raizesProjeto() {
  const r = [path.resolve(__dirname, '..', '..')];
  if (process.env.CLAUDE_PROJECT_DIR) r.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  return [...new Set(r.map(x => barras(x).toLowerCase().replace(/\/+$/, '')))];
}

// Tira "::$DATA" e fluxos alternativos ("arquivo:fluxo") e pontos/espacos finais de cada segmento.
function limparCaminhoTexto(p) {
  const partes = barras(p).split('/');
  return partes.map((seg, i) => {
    if (i === 0 && /^[a-z]:$/i.test(seg)) return seg;
    let s = seg;
    if (i === 0 && /^[a-z]:/i.test(s)) { // "C:arquivo" (raro): mantem a letra
      return s.slice(0, 2) + limparNome(s.slice(2).split(':')[0]);
    }
    const dois = s.indexOf(':');
    if (dois >= 0) s = s.slice(0, dois);
    return limparNome(s);
  }).join('/');
}

function realpathMaisProximo(abs) {
  try { return fs.realpathSync.native(abs); } catch (_) { /* nao existe */ }
  let atual = abs;
  const resto = [];
  for (let i = 0; i < 64; i++) {
    const pai = path.dirname(atual);
    if (pai === atual) return null;
    resto.unshift(path.basename(atual));
    atual = pai;
    try { return path.join(fs.realpathSync.native(atual), ...resto); } catch (_) { /* sobe */ }
  }
  return null;
}

function variantesCaminho(p, cwd) {
  const base = cwd || process.cwd();
  const limpo = limparCaminhoTexto(p);
  const abs = path.resolve(base, limpo);
  const vs = [abs];
  const real = realpathMaisProximo(abs);
  if (real) vs.push(real);
  // Caminho original sem limpeza tambem, resolvido.
  vs.push(path.resolve(base, barras(p)));
  return [...new Set(vs.map(v => limparCaminhoTexto(v).toLowerCase()))];
}

function categoriaCaminhoNormalizado(norm, escrita) {
  const segs = norm.split('/').filter(Boolean);
  for (const s of segs) {
    const c = categoriaNome(s);
    if (c) return c;
  }
  if (/(^|\/)atendeia\/data(\/|$)/.test(norm)) return CAT.dados;
  for (const raiz of raizesProjeto()) {
    if (norm === raiz + '/data' || norm.startsWith(raiz + '/data/')) return CAT.dados;
  }
  if (escrita) {
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i] !== '.claude') continue;
      if (segs[i + 1] === 'hooks') return CAT.hook;
      if (i + 1 === segs.length - 1 && /^settings.*\.json$/.test(segs[i + 1])) return CAT.hook;
    }
  }
  return null;
}

function categoriaCaminho(p, cwd, escrita) {
  for (const v of variantesCaminho(p, cwd)) {
    const c = categoriaCaminhoNormalizado(v, escrita);
    if (c) return c;
  }
  return null;
}

// Padrao de busca (pattern do Glob, glob do Grep): olha cada pedaco sem os curingas finais.
function categoriaPadrao(texto) {
  const pedacos = barras(texto).split(/[\/{},\s]+/).filter(Boolean);
  for (const p of pedacos) {
    const c = categoriaNome(p) || categoriaNome(p.replace(/[*?]+$/, '')) || categoriaNome(p.replace(/^[*?]+/, 'x'));
    if (c) return c;
  }
  if (/(^|\/)atendeia\/data(\/|$)/i.test(barras(texto))) return CAT.dados;
  return null;
}

function caminhosDaFerramenta(nome, ti, cwd) {
  const lista = [];
  const add = (v, base) => { if (typeof v === 'string' && v) lista.push({ p: v, base: base || cwd }); };
  add(ti.file_path); add(ti.notebook_path); add(ti.path);
  if (nome === 'Artifact') {
    const raiz = typeof ti.root === 'string' && ti.root ? path.resolve(cwd, ti.root) : cwd;
    if (Array.isArray(ti.file_paths)) ti.file_paths.forEach(v => add(v));
    if (Array.isArray(ti.files)) ti.files.forEach(f => add(f && f.path, raiz));
    else if (ti.files && typeof ti.files === 'object') {
      for (const v of Object.values(ti.files)) {
        if (typeof v === 'string') add(v, raiz);
        else if (v && typeof v.from === 'string') add(v.from, raiz);
      }
    }
    add(ti.out_dir);
  }
  if (Array.isArray(ti.edits)) ti.edits.forEach(e => e && add(e.file_path));
  return lista;
}

function analisarArquivo(nome, ti, cwd) {
  const escrita = FERRAMENTAS_ESCRITA.has(nome);
  const caminhos = caminhosDaFerramenta(nome, ti, cwd);
  if ((nome === 'Grep' || nome === 'Glob') && !caminhos.length) caminhos.push({ p: cwd, base: cwd });
  if (!caminhos.length && nome !== 'Artifact') return CAT.entrada; // ferramenta de arquivo sem caminho
  for (const { p, base } of caminhos) {
    const c = categoriaCaminho(p, base, escrita);
    if (c) return c;
  }
  if (nome === 'Glob' && typeof ti.pattern === 'string') { const c = categoriaPadrao(ti.pattern); if (c) return c; }
  if (nome === 'Grep' && typeof ti.glob === 'string') { const c = categoriaPadrao(ti.glob); if (c) return c; }
  return null;
}

// ---------- Comandos (Bash e PowerShell) ----------

const SEPARA_PALAVRAS = /[\s\/\\'"=:@;|&()<>`,{}\[\]]+/;

function categoriaNomesNoComando(cmd) {
  for (const pedaco of cmd.split(SEPARA_PALAVRAS)) {
    if (!pedaco) continue;
    const c = categoriaNome(pedaco) || categoriaNome(pedaco.replace(/[*?]+$/, ''));
    if (c) return c;
  }
  if (/atendeia[\\\/]+data([\\\/\s'";|&)]|$)/i.test(cmd)) return CAT.dados;
  // "data" da raiz do projeto: relativo (data/, .\data) ou absoluto.
  if (/(^|[\s'"=(])(\.[\\\/]+)?data[\\\/]/i.test(cmd)) return CAT.dados;
  if (/(^|[\s'"=(])\.[\\\/]+data([\s'";|&)]|$)/i.test(cmd)) return CAT.dados;
  const b = barras(cmd).toLowerCase();
  for (const raiz of raizesProjeto()) {
    const i = b.indexOf(raiz + '/data');
    if (i >= 0 && /^([\/\s'";|&)]|$)/.test(b.slice(i + raiz.length + 5))) return CAT.dados;
  }
  return null;
}

const PREFIXOS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'builtin', 'noglob', 'xargs', 'nice', 'stdbuf', 'call', 'start', '&', '.']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'cmd', 'powershell', 'pwsh', 'wsl']);

function nomeComando(tok) {
  const t = tok.replace(/['"]/g, '');
  const base = t.split(/[\\\/]/).pop().toLowerCase();
  return base.replace(/\.(exe|cmd|bat|com)$/, '');
}

// Divide em trechos e devolve [{ cmd, args }] com a palavra de comando de cada trecho.
function trechos(comando) {
  const saida = [];
  const fila = comando.split(/\|\||&&|\$\(|[;|&\n\r`(){}]/);
  while (fila.length) {
    const texto = fila.shift().replace(/['"]/g, ' ');
    let toks = texto.trim().split(/\s+/).filter(Boolean);
    for (let guarda = 0; guarda < 32 && toks.length; guarda++) {
      const c = nomeComando(toks[0]);
      if (PREFIXOS.has(c) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) { toks = toks.slice(1); continue; }
      if (c === 'timeout') { toks = toks.slice(1); while (toks.length && /^(-|\d)/.test(toks[0])) toks = toks.slice(1); continue; }
      if (c === 'env' && toks.slice(1).some(t => !t.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))) {
        toks = toks.slice(1); while (toks.length && (toks[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]))) toks = toks.slice(1);
        continue;
      }
      if (SHELLS.has(c) && toks.length > 1) {
        // bash -c "...", cmd /c ..., powershell -Command ...: analisa o que vem depois das opcoes.
        let r = toks.slice(1);
        while (r.length && /^[-\/]/.test(r[0])) r = r.slice(1);
        if (r.length) { toks = r; continue; }
      }
      break;
    }
    if (toks.length) saida.push({ cmd: nomeComando(toks[0]), args: toks.slice(1).map(t => t.replace(/['"]/g, '')) });
  }
  return saida;
}

function categoriaAmbiente(comando, lista) {
  if (/\$env:(?![A-Za-z_{])/i.test(comando)) return CAT.ambiente;
  if (/(^|[\s'"(,])env:(?![A-Za-z_0-9])/i.test(comando)) return CAT.ambiente;
  if (/GetEnvironmentVariables\b/i.test(comando)) return CAT.ambiente;
  if (/process\.env\s*[),}]/.test(comando)) return CAT.ambiente;
  if (/os\.environ\s*[),}]/.test(comando)) return CAT.ambiente;
  for (const { cmd, args } of lista) {
    const naoOpcoes = args.filter(a => !a.startsWith('-'));
    if (cmd === 'printenv') return CAT.ambiente;
    if (cmd === 'env' && args.every(a => a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a))) return CAT.ambiente;
    if (cmd === 'set' && args.length === 0) return CAT.ambiente;
    if (cmd === 'export' && (args.length === 0 || args.every(a => a === '-p'))) return CAT.ambiente;
    if ((cmd === 'declare' || cmd === 'typeset') && naoOpcoes.length === 0) return CAT.ambiente;
    if (['node', 'deno', 'bun', 'python', 'python3', 'py'].includes(cmd)) {
      const t = args.join(' ');
      if (/process\.env(?![.\[\w])/.test(t) || /os\.environ(?![.\[\w])/.test(t)) return CAT.ambiente;
    }
  }
  return null;
}

const DOCKER_PROIBIDO = new Set(['config', 'inspect', 'exec', 'run', 'cp']);

function categoriaDocker(lista) {
  for (const { cmd, args } of lista) {
    if (cmd !== 'docker' && cmd !== 'docker-compose') continue;
    if (args.some(a => DOCKER_PROIBIDO.has(a.toLowerCase()))) return CAT.docker;
  }
  return null;
}

const SERVIDOR = new Set(['ssh', 'scp', 'sftp', 'rclone', 'tailscale', 'ssh-keygen', 'ssh-add']);

function categoriaServidor(lista) {
  return lista.some(t => SERVIDOR.has(t.cmd)) ? CAT.servidor : null;
}

const GIT_LEITURA = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame']);

function categoriaGit(lista) {
  for (const { cmd, args } of lista) {
    if (cmd !== 'git') continue;
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) {
      const a = args[i];
      if (a === '-c' || (/^-c./.test(a) && !a.startsWith('--'))) return CAT.git;
      if (a === '--config-env' || a.startsWith('--config-env=')) return CAT.git;
      if (a === '-C' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') i += 2;
      else i += 1;
    }
    if (i >= args.length) continue; // "git" ou "git --version"
    const sub = args[i].toLowerCase();
    const resto = args.slice(i + 1);
    if (GIT_LEITURA.has(sub)) {
      if (resto.some(a => a === '--output' || a.startsWith('--output=') || a === '-o')) return CAT.git;
      continue;
    }
    if (sub === 'branch' && resto.length === 1 && resto[0] === '--show-current') continue;
    if (sub === 'remote' && resto.length === 1 && (resto[0] === '-v' || resto[0] === '--verbose')) continue;
    return CAT.git;
  }
  return null;
}

const GRAVA = new Set(['cp', 'mv', 'rm', 'del', 'erase', 'copy', 'move', 'ren', 'rename', 'tee', 'touch', 'ln', 'rmdir', 'rd', 'mkdir', 'md',
  'truncate', 'dd', 'install', 'chmod', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'remove-item', 'ri', 'copy-item', 'cpi',
  'move-item', 'mi', 'rename-item', 'rni', 'new-item', 'ni', 'clear-content', 'clc', 'set-item', 'si']);

function categoriaGravaHook(comando, lista) {
  if (!/\.claude[\\\/]+(settings|hooks)/i.test(comando)) return null;
  if (/(^|[^0-9&])>{1,2}(?!&)/.test(comando.replace(/2>\s*(\/dev\/null|\$null|nul)\b/gi, ''))) return CAT.hook;
  if (/(writeFile|appendFile|unlink|rmSync|rmdirSync|renameSync|copyFile|cpSync|symlink|WriteAllText|WriteAllBytes)/i.test(comando)) return CAT.hook;
  for (const { cmd, args } of lista) {
    if (GRAVA.has(cmd)) return CAT.hook;
    if ((cmd === 'sed' || cmd === 'perl') && args.some(a => /^-[a-z]*i/.test(a))) return CAT.hook;
  }
  return null;
}

function analisarComando(comando) {
  if (typeof comando !== 'string') return CAT.entrada;
  const lista = trechos(comando);
  return categoriaNomesNoComando(comando)
    || categoriaAmbiente(comando, lista)
    || categoriaDocker(lista)
    || categoriaServidor(lista)
    || categoriaGit(lista)
    || categoriaGravaHook(comando, lista);
}

// ---------- Entrada ----------

function analisar(entrada) {
  if (!entrada || typeof entrada !== 'object') return CAT.entrada;
  const nome = entrada.tool_name;
  const ti = entrada.tool_input;
  if (typeof nome !== 'string') return CAT.entrada;
  const cwd = typeof entrada.cwd === 'string' && entrada.cwd ? entrada.cwd : process.cwd();
  if (FERRAMENTAS_ARQUIVO.has(nome)) {
    if (!ti || typeof ti !== 'object') return CAT.entrada;
    return analisarArquivo(nome, ti, cwd);
  }
  if (FERRAMENTAS_SHELL.has(nome)) {
    if (!ti || typeof ti !== 'object') return CAT.entrada;
    return analisarComando(ti.command);
  }
  return null;
}

function mensagem(cat) {
  return 'Bloqueado pelo hook de seguranca: [' + cat + ']. Agentes nao leem segredos, nao acessam o servidor e nao '
    + 'fazem git que altera o repositorio. Se a tarefa precisar disso, pare e avise o Eduardo (regra 1 do EQUIPE-AGENTES.md).';
}

function bloquear(cat) {
  try { process.stderr.write(mensagem(cat) + '\n'); } catch (_) { /* nada */ }
  process.exit(2);
}

function main() {
  const partes = [];
  process.stdin.on('data', d => partes.push(d));
  process.stdin.on('error', () => bloquear(CAT.entrada));
  process.stdin.on('end', () => {
    try {
      const entrada = JSON.parse(Buffer.concat(partes).toString('utf8'));
      const cat = analisar(entrada);
      if (cat) bloquear(cat);
      process.exit(0);
    } catch (_) {
      bloquear(CAT.entrada);
    }
  });
}

module.exports = { analisar, analisarComando, categoriaNome, categoriaCaminho, mensagem, CAT };

if (require.main === module) {
  process.on('uncaughtException', () => bloquear(CAT.entrada));
  main();
}
