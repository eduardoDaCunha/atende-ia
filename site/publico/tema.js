'use strict';
/* Tema claro ou escuro em todas as páginas. Carrega no <head>, sem defer, para a tela não piscar.
   Sem escolha salva, segue o tema do sistema. */
(() => {
  const CHAVE = 'atende-tema';
  const COR_BARRA = { light: '#ffffff', dark: '#0a0a0b' };
  const ICONES = {
    light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z'
  };
  const sistema = window.matchMedia('(prefers-color-scheme: light)');
  const botoes = new Map();

  // Em janela privada ou com dados bloqueados, o acesso ao armazenamento pode falhar.
  function lerEscolha() {
    try { const valor = localStorage.getItem(CHAVE); return valor === 'light' || valor === 'dark' ? valor : null; }
    catch { return null; }
  }
  function salvarEscolha(tema) {
    try { localStorage.setItem(CHAVE, tema); } catch { /* Vale só até recarregar a página. */ }
  }
  const temaAtual = () => lerEscolha() || (sistema.matches ? 'light' : 'dark');

  function aplicar(tema) {
    document.documentElement.dataset.theme = tema;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[tema]);
    botoes.forEach((botao, nome) => botao.setAttribute('aria-pressed', String(nome === tema)));
  }
  aplicar(temaAtual());

  function criarBotao(tema, rotulo) {
    const NS = 'http://www.w3.org/2000/svg';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.title = rotulo;
    botao.setAttribute('aria-label', rotulo);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const caminho = document.createElementNS(NS, 'path');
    caminho.setAttribute('d', ICONES[tema]);
    svg.append(caminho);
    botao.append(svg);
    botao.addEventListener('click', () => { salvarEscolha(tema); aplicar(tema); });
    botoes.set(tema, botao);
    return botao;
  }

  function montarSeletor() {
    const seletor = document.createElement('div');
    seletor.className = 'tema';
    seletor.setAttribute('role', 'group');
    seletor.setAttribute('aria-label', 'Tema da tela');
    seletor.append(criarBotao('light', 'Tema claro'), criarBotao('dark', 'Tema escuro'));

    const topoSite = document.querySelector('.topbar-inner');
    const navPainel = document.querySelector('.bar nav');
    const barraPainel = document.querySelector('.bar');
    if (topoSite) topoSite.lastElementChild.before(seletor);
    else if (navPainel) navPainel.prepend(seletor);
    else if (barraPainel) barraPainel.append(seletor);
    aplicar(temaAtual());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarSeletor);
  else montarSeletor();

  sistema.addEventListener('change', () => { if (!lerEscolha()) aplicar(temaAtual()); });
  window.addEventListener('storage', evento => { if (evento.key === CHAVE) aplicar(temaAtual()); });
})();
