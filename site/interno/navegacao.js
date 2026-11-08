'use strict';
/* Navegação do painel por ícones: a página abre em uma tela inicial e cada função abre sozinha.
   Não muda o funcionamento do painel: só mostra e esconde o que já existe na página.
   As permissões continuam sendo verificadas pelo servidor. */
(() => {
  const ICONES = {
    empresaNova: 'M4 21V5l8-2v18M12 9l8 2v4M7 8h2M7 12h2M7 16h2M4 21h9M18 18v5M15.5 20.5h5',
    empresas: 'M4 21V5l8-2v18M12 9l8 2v10M7 8h2M7 12h2M7 16h2M15 14h2M15 18h2M3 21h18',
    usuarioNovo: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a6 6 0 0 1 11-3M18 14v7M14.5 17.5h7',
    usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a6 6 0 0 1 12 0v2M16 3.5a4 4 0 0 1 0 7M18 14.5a6 6 0 0 1 4 5.5v1',
    agente: 'M12 3v3M5 8h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM9 13v1M15 13v1M9 17h6M1.5 12v4M22.5 12v4',
    seguranca: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3ZM9 12l2 2 4-4',
    diagnostico: 'M3 12h4l2.5-6 4.5 12 2.5-6H21',
    auditoria: 'M6 3h9l4 4v14H6V3ZM15 3v4h4M9 12h7M9 16h7',
    fila: 'M4 6h16M4 12h16M4 18h10M18 16l1.5 1.5L22 15',
    pedidos: 'M4 13l2.5-8h11L20 13v6H4v-6ZM4 13h5l1 2h4l1-2h5',
    conversa: 'M4 5h16v11H9l-5 4V5ZM8 9h8M8 12h5',
    painel: 'M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z',
    site: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
    senha: 'M14.5 10a4.5 4.5 0 1 0-3.4 4.4L13 16.5h2v2h2v2h3.5V17l-6.2-6.2c.1-.3.2-.5.2-.8ZM8 9h.01',
    solicitacaoNova: 'M6 3h9l4 4v14H6V3ZM15 3v4h4M12.5 11v6M9.5 14h6',
    solicitacoes: 'M4 5h16v11H9l-5 4V5ZM8 9l1.5 1.5L12 8',
    suporte: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01'
  };
  const SENHA = { id: 'senha', titulo: 'Alterar senha', texto: 'Trocar a senha da sua conta', icone: 'senha', clicar: '#change-password' };
  const SITE = { id: 'site', titulo: 'Ver o site', texto: 'Abrir a página pública', icone: 'site', link: '/' };
  const DADOS_EMPRESA = { id: 'dados-empresa', titulo: 'Dados da empresa', texto: 'Horário, endereço, serviços, preços e perguntas', icone: 'empresas', mostrar: ['#dados-empresa-box'], abrir: () => window.atualizarEmpresasDosDados?.() };

  /* mostrar: o que aparece nessa tela. etapas: formulário em passo a passo. */
  const PAGINAS = {
    admin: [
      { grupo: 'Cadastros', itens: [
        { id: 'nova-empresa', titulo: 'Cadastrar empresa', texto: 'Nome, cidade, contato e confirmação', icone: 'empresaNova', mostrar: ['#new-company', '#companies-feedback'],
          etapas: { form: '#new-company', passos: [{ nome: 'Empresa', campos: ['name', 'city', 'uf', 'timeZone'] }, { nome: 'Contato', campos: ['contact', 'notes'] }] } },
        { id: 'novo-usuario', titulo: 'Cadastrar usuário', texto: 'Pessoa, acesso e empresa', icone: 'usuarioNovo', mostrar: ['#create-user', '#generated-password', '#users-feedback'],
          etapas: { form: '#create-user', passos: [{ nome: 'Pessoa', campos: ['name'] }, { nome: 'Acesso', campos: ['username', 'role'] }, { nome: 'Empresa', campos: ['companyId'] }] } }
      ] },
      { grupo: 'Gestão', itens: [
        { id: 'empresas', titulo: 'Empresas', texto: 'Planos, assinaturas e vencimentos', icone: 'empresas', mostrar: ['#companies-list', '#companies-feedback'] },
        DADOS_EMPRESA,
        { id: 'usuarios', titulo: 'Usuários', texto: 'Perfis, bloqueios e senhas', icone: 'usuarios', mostrar: ['#users-list', '#users-list + p', '#generated-password', '#users-feedback'] },
        { id: 'agente', titulo: 'Agente', texto: 'Nome, serviços e regras de resposta', icone: 'agente', mostrar: ['#config-form'],
          etapas: { form: '#config-form', passos: [{ nome: 'Identidade', campos: ['companyId', 'name', 'assistantName', 'serviceArea'] }, { nome: 'Serviços e regras', campos: ['services', 'policy'] }, { nome: 'Mensagens', campos: ['contact', 'welcome'] }] } }
      ] },
      { grupo: 'Sistema', itens: [
        { id: 'seguranca', titulo: 'Segurança', texto: 'Tentativas de login e bloqueios', icone: 'seguranca', mostrar: ['#security-panel'] },
        { id: 'diagnostico', titulo: 'Diagnóstico', texto: 'Estado do sistema e backups', icone: 'diagnostico', mostrar: ['#health', '#health ~ p.fine'] },
        { id: 'chamados', titulo: 'Chamados', texto: 'Suporte técnico pedido pelas empresas', icone: 'suporte', mostrar: ['#chamados-admin-box'] },
        { id: 'auditoria', titulo: 'Auditoria', texto: 'Ações registradas no painel', icone: 'auditoria', mostrar: ['#audit', '#refresh-audit'] }
      ] },
      { grupo: 'Outras áreas', itens: [
        { id: 'atendimento', titulo: 'Atendimento', texto: 'Fila, pedidos e WhatsApp', icone: 'painel', link: '/atendimento' },
        SITE, SENHA
      ] }
    ],
    atendimento: [
      { grupo: 'Atendimento', itens: [
        { id: 'fila', titulo: 'Fila', texto: 'Solicitações e respostas', icone: 'fila', contador: true, mostrar: ['#stats', 'main > .columns > .box:first-child > .row', '#staff-list', 'main > .columns > .box:nth-child(2)'] },
        { id: 'whatsapp', titulo: 'WhatsApp', texto: 'Conversas com robô e atendente', icone: 'conversa', whatsapp: true, mostrar: ['#wpp-box'] },
        { id: 'pedidos-site', titulo: 'Pedidos do site', texto: 'Contatos recebidos pelo formulário', icone: 'pedidos', soAdmin: true, mostrar: ['#show-leads', '#leads'], abrir: () => { const lista = document.querySelector('#leads'); if (lista.classList.contains('hidden')) document.querySelector('#show-leads').click(); } },
        DADOS_EMPRESA,
        { id: 'suporte', titulo: 'Suporte técnico', texto: 'Abrir e acompanhar chamados', icone: 'suporte', mostrar: ['#chamados-box'] }
      ] },
      { grupo: 'Outras áreas', itens: [
        { id: 'administracao', titulo: 'Administração', texto: 'Empresas, usuários e sistema', icone: 'painel', link: '/admin', soAdmin: true },
        SITE, SENHA
      ] }
    ],
    cliente: [
      { grupo: 'Minha área', itens: [
        { id: 'nova-solicitacao', titulo: 'Nova solicitação', texto: 'Assunto, descrição e envio', icone: 'solicitacaoNova', mostrar: ['#new-request', '#new-feedback'],
          etapas: { form: '#new-request', passos: [{ nome: 'Assunto', campos: ['subject'] }, { nome: 'Descrição', campos: ['description'] }] } },
        { id: 'solicitacoes', titulo: 'Minhas solicitações', texto: 'Andamento e mensagens', icone: 'solicitacoes', mostrar: ['#request-list', 'main > .columns > .box:nth-child(2)'] }
      ] },
      { grupo: 'Outras áreas', itens: [SITE, SENHA] }
    ]
  };

  const pagina = document.body.dataset.page;
  const grupos = PAGINAS[pagina];
  const main = document.querySelector('main');
  if (!grupos || !main) return;
  const itens = grupos.flatMap(g => g.itens);
  const criar = (tag, classe, texto) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texto !== undefined) n.textContent = texto; return n; };

  function icone(nome) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const caminho = document.createElementNS(NS, 'path');
    caminho.setAttribute('d', ICONES[nome]);
    svg.append(caminho);
    return svg;
  }

  /* Tela inicial */
  const inicio = criar('div', 'nav-home');
  const cartoes = new Map();
  for (const grupo of grupos) {
    const secao = criar('section', 'nav-group');
    secao.append(criar('h2', 'nav-group-title', grupo.grupo));
    const grade = criar('div', 'nav-grid');
    for (const item of grupo.itens) {
      const cartao = criar(item.clicar ? 'button' : 'a', 'nav-tile');
      if (item.clicar) cartao.type = 'button';
      else cartao.href = item.link || `#${item.id}`;
      if (item.clicar) cartao.addEventListener('click', () => document.querySelector(item.clicar).click());
      const caixa = criar('span', 'nav-icon');
      caixa.append(icone(item.icone));
      cartao.append(caixa, criar('strong', '', item.titulo), criar('span', 'nav-text', item.texto));
      grade.append(cartao);
      cartoes.set(item.id, cartao);
    }
    secao.append(grade);
    inicio.append(secao);
  }

  /* Cabeçalho de cada tela */
  const topo = criar('div', 'nav-view-head');
  const voltar = criar('a', 'ghost link nav-back', 'Voltar ao início');
  voltar.href = '#inicio';
  const titulo = criar('h1', 'nav-view-title');
  titulo.tabIndex = -1;
  const descricao = criar('p', 'muted');
  topo.append(voltar, titulo, descricao);
  const cabecalho = main.querySelector('.heading');
  if (cabecalho) cabecalho.after(inicio); else main.prepend(inicio);
  main.prepend(topo);

  /* Passo a passo */
  function passoAPasso({ form: seletor, passos }) {
    const form = document.querySelector(seletor);
    if (!form) return null;
    const enviar = form.querySelector('button.primary, button:not([type="button"])');
    const fim = passos.length;
    let atual = 0;
    const progresso = criar('div', 'nav-steps');
    progresso.setAttribute('aria-live', 'polite');
    const marcas = [...passos.map(p => p.nome), 'Confirmar'].map((nome, i) => {
      const marca = criar('span', 'nav-step');
      marca.append(criar('b', '', String(i + 1)), criar('span', '', nome));
      progresso.append(marca);
      return marca;
    });
    const revisao = criar('dl', 'nav-review');
    const botoes = criar('div', 'nav-step-actions');
    const anterior = criar('button', 'ghost', 'Voltar');
    anterior.type = 'button';
    const proximo = criar('button', 'primary', 'Continuar');
    proximo.type = 'button';
    botoes.append(anterior, proximo, enviar);
    form.prepend(progresso);
    form.append(revisao, botoes);
    form.classList.add('nav-wizard');
    // A validação é feita por etapa: a do navegador travaria o Enter nos campos ainda escondidos.
    form.noValidate = true;

    const campo = nome => form.elements[nome];
    const rotulo = nome => campo(nome)?.closest('label');
    function montarRevisao() {
      revisao.replaceChildren();
      for (const passo of passos) for (const nome of passo.campos) {
        const el = campo(nome);
        if (!el) continue;
        const valor = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent : el.value;
        const legenda = rotulo(nome).firstChild?.textContent?.trim() || nome;
        revisao.append(criar('dt', '', legenda), criar('dd', '', valor?.trim() || 'Não informado'));
      }
    }
    function desenhar() {
      // O que não é campo (dicas, listas de sugestão) segue o campo anterior.
      let dono = 0;
      for (const filho of form.children) {
        if ([progresso, revisao, botoes].includes(filho) || filho.classList.contains('notice')) continue;
        const indice = passos.findIndex(p => p.campos.some(nome => rotulo(nome) === filho));
        if (indice >= 0) dono = indice;
        filho.classList.toggle('nav-off', dono !== atual);
      }
      const ultimo = atual === fim;
      if (ultimo) montarRevisao();
      revisao.classList.toggle('nav-off', !ultimo);
      enviar.classList.toggle('nav-off', !ultimo);
      proximo.classList.toggle('nav-off', ultimo);
      anterior.classList.toggle('nav-off', atual === 0);
      marcas.forEach((marca, i) => {
        marca.classList.toggle('on', i === atual);
        marca.classList.toggle('done', i < atual);
      });
    }
    function avancar() {
      for (const nome of passos[atual].campos) if (campo(nome) && !campo(nome).reportValidity()) return;
      atual++;
      desenhar();
    }
    proximo.addEventListener('click', avancar);
    anterior.addEventListener('click', () => { atual--; desenhar(); });
    // Enter antes da última etapa avança, em vez de enviar com campos ainda não vistos.
    form.addEventListener('submit', event => {
      if (atual === fim) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      avancar();
    }, true);
    form.addEventListener('reset', () => { atual = 0; desenhar(); });
    return { desenhar, reiniciar: () => { if (atual === fim) { atual = 0; } desenhar(); } };
  }
  const assistentes = new Map();
  for (const item of itens) if (item.etapas) assistentes.set(item.id, passoAPasso(item.etapas));

  /* Mostra só o que a tela pede, sem tirar nada do lugar. */
  function aplicar(alvos) {
    main.querySelectorAll('.nav-off').forEach(n => {
      if (!n.closest('.nav-wizard') || n.classList.contains('nav-wizard')) n.classList.remove('nav-off');
    });
    const percorrer = pai => {
      for (const filho of pai.children) {
        if (alvos.some(alvo => filho === alvo)) continue;
        if (alvos.some(alvo => filho.contains(alvo))) percorrer(filho);
        else filho.classList.add('nav-off');
      }
    };
    percorrer(main);
  }
  function abrir() {
    const id = location.hash.slice(1);
    const item = itens.find(i => i.id === id && i.mostrar);
    const estavaAberto = main.dataset.view;
    if (!item) {
      main.dataset.view = '';
      aplicar([inicio, main.querySelector('.heading > div')].filter(Boolean));
      if (estavaAberto) cartoes.get(estavaAberto)?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
    main.dataset.view = item.id;
    titulo.textContent = item.titulo;
    descricao.textContent = item.texto;
    const alvos = item.mostrar.flatMap(seletor => [...main.querySelectorAll(seletor)]);
    aplicar([topo, ...alvos]);
    assistentes.get(item.id)?.reiniciar();
    item.abrir?.();
    window.scrollTo(0, 0);
    titulo.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', abrir);
  abrir();

  /* Ajustes conforme o perfil e o que está ativo. Só muda a exibição: o servidor decide o acesso. */
  const esconderCartao = id => cartoes.get(id)?.classList.add('nav-off');
  const lerJson = rota => fetch(rota, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (pagina === 'atendimento') {
    lerJson('/api/auth/me').then(dados => {
      if (dados?.user?.role !== 'admin') { esconderCartao('administracao'); esconderCartao('pedidos-site'); }
      else esconderCartao('dados-empresa'); // o admin edita pela Administração, onde escolhe a empresa
    });
    lerJson('/api/staff/whatsapp').then(dados => { if (!dados?.enabled) esconderCartao('whatsapp'); });
    lerJson('/api/staff/stats').then(dados => {
      if (!dados?.novo) return;
      const selo = criar('span', 'nav-badge', String(dados.novo));
      selo.setAttribute('aria-label', `${dados.novo} novas`);
      cartoes.get('fila').append(selo);
    });
  }
})();
