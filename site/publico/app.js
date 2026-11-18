'use strict';

/* Conversa: cada chat da página tem o próprio histórico e o próprio endereço de resposta. */
function connectChat({ card, welcome, endpoint }) {
  const chat = card.querySelector('.chat-history');
  const form = card.querySelector('.chat-input');
  const messageInput = form.querySelector('input');
  const sendButton = form.querySelector('[type="submit"]');
  let history = [];
  let busy = false;
  let requestId = 0;
  let activeController = null;

  function bubble(text, who) {
    const node = document.createElement('div');
    node.className = `message ${who}`;
    // Somente texto: não renderizar HTML recebido da IA ou do visitante.
    node.textContent = text;
    chat.append(node);
    chat.scrollTop = chat.scrollHeight;
    return node;
  }
  function loadingBubble() {
    const node = bubble('', 'agent');
    const dots = document.createElement('span');
    dots.className = 'typing';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = 'Preparando resposta';
    node.append(dots, label);
    return node;
  }
  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
  }
  function reset() {
    requestId++;
    activeController?.abort();
    activeController = null;
    setBusy(false);
    history = [];
    chat.replaceChildren();
    bubble(welcome, 'agent');
    messageInput.value = '';
  }
  async function ask(text, keepFocus = false) {
    const message = text.trim();
    if (!message || busy) return;
    const myRequest = ++requestId;
    setBusy(true);
    bubble(message, 'visitor');
    const loading = loadingBubble();
    const controller = new AbortController();
    activeController = controller;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Tente novamente em instantes.');
      if (myRequest !== requestId) return;
      loading.textContent = result.answer;
      history.push({ role: 'user', text: message }, { role: 'assistant', text: result.answer });
      history = history.slice(-8);
    } catch (error) {
      if (myRequest !== requestId) return;
      loading.textContent = `Não consegui responder agora. ${error.message}`;
    } finally {
      if (myRequest === requestId) {
        setBusy(false);
        activeController = null;
        if (keepFocus) messageInput.focus({ preventScroll: true });
        chat.scrollTop = chat.scrollHeight;
      }
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const message = messageInput.value;
    if (!message.trim() || busy) return;
    messageInput.value = '';
    ask(message, true);
  });
  card.querySelectorAll('[data-msg]').forEach(button => button.addEventListener('click', () => ask(button.dataset.msg)));
  card.querySelector('[data-restart]').addEventListener('click', reset);
  reset();
}

/* Contato com a equipe */
function connectContact() {
  const dialog = document.querySelector('#commercial-dialog');
  const contactForm = document.querySelector('#commercial-form');
  const feedback = document.querySelector('#commercial-feedback');
  document.querySelectorAll('[data-open-contact]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  document.querySelector('#close-commercial').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  /* Com o cartão de agradecimento na tela, o primeiro Esc fecha só o cartão; sem cartão, o Esc funciona como antes. */
  dialog.addEventListener('cancel', event => { if (fecharAgradecimento()) event.preventDefault(); });
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = contactForm.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(contactForm).entries());
    data.consent = Boolean(data.consent);
    feedback.textContent = '';
    button.disabled = true;
    try {
      const response = await fetch('/api/commercial-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível enviar o pedido.');
      feedback.textContent = 'Pedido registrado para a equipe. Obrigado.';
      mostrarAgradecimento();
      contactForm.reset();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

/* Cartão de agradecimento: só depois que o servidor aceita o pedido. Popover manual, para ficar por cima do
   diálogo modal sem escurecer a página nem roubar o foco. 5 s no total: 0,6 s entrando, 3,8 s legível, 0,6 s saindo. */
const AGRADECIMENTO_SAIDA_MS = 4400;
const AGRADECIMENTO_TOTAL_MS = 5000;
const AGRADECIMENTO_ANIMACAO_MS = 600;
let agradecimento = null;
let agradecimentoTimers = [];

function limparTimersAgradecimento() {
  agradecimentoTimers.forEach(clearTimeout);
  agradecimentoTimers = [];
}

function agradecimentoAberto() {
  return Boolean(agradecimento && agradecimento.matches(':popover-open'));
}

function esconderAgradecimento() {
  limparTimersAgradecimento();
  if (!agradecimento) return;
  agradecimento.classList.remove('entrando', 'saindo');
  if (agradecimentoAberto()) agradecimento.hidePopover();
}

/* Inicia a saída; devolve true se havia cartão na tela. */
function fecharAgradecimento() {
  if (!agradecimentoAberto()) return false;
  if (agradecimento.classList.contains('saindo')) return true;
  limparTimersAgradecimento();
  agradecimento.classList.remove('entrando');
  agradecimento.classList.add('saindo');
  agradecimentoTimers.push(setTimeout(esconderAgradecimento, AGRADECIMENTO_ANIMACAO_MS));
  return true;
}

function mostrarAgradecimento() {
  if (typeof HTMLElement.prototype.showPopover !== 'function') return;
  if (!agradecimento) {
    agradecimento = document.createElement('div');
    agradecimento.className = 'agradecimento';
    agradecimento.setAttribute('popover', 'manual');
    agradecimento.setAttribute('role', 'status');
    agradecimento.setAttribute('aria-live', 'polite');
    const titulo = document.createElement('strong');
    titulo.textContent = 'Obrigado!';
    const texto = document.createElement('p');
    texto.textContent = 'Recebemos seu pedido! Nossa equipe entrará em contato em breve.';
    agradecimento.append(titulo, texto);
    agradecimento.addEventListener('click', fecharAgradecimento);
    document.body.append(agradecimento);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && fecharAgradecimento()) event.preventDefault();
    });
  }
  limparTimersAgradecimento();
  agradecimento.classList.remove('entrando', 'saindo');
  /* Fecha e reabre para o popover voltar ao topo (acima do diálogo) e a animação recomeçar. */
  if (agradecimentoAberto()) agradecimento.hidePopover();
  agradecimento.showPopover();
  void agradecimento.offsetWidth;
  agradecimento.classList.add('entrando');
  agradecimentoTimers.push(setTimeout(fecharAgradecimento, AGRADECIMENTO_SAIDA_MS));
  agradecimentoTimers.push(setTimeout(esconderAgradecimento, AGRADECIMENTO_TOTAL_MS));
}

/* Telas do console: abas com teclado (setas, Home e End). */
function connectTabs() {
  const tabs = [...document.querySelectorAll('.console-tabs [role="tab"]')];
  const select = tab => tabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.querySelector(`#${item.getAttribute('aria-controls')}`).hidden = !active;
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      const next = tabs[(moves[event.key] + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}

/* Inicialização */
connectContact();
connectTabs();
fetch('/api/status')
  .then(response => response.ok ? response.json() : null)
  .then(status => {
    if (status?.version) document.querySelectorAll('[data-version]').forEach(node => { node.textContent = status.version; });
  })
  .catch(() => { /* A versão escrita na página continua valendo. */ });
connectChat({
  card: document.querySelector('#agente'),
  endpoint: '/api/chat',
  welcome: 'Olá! Sou o agente virtual da Atende.IA. Pergunte como funciona, o que dá para automatizar ou se serve para a sua empresa. Se quiser, conte o seu ramo.'
});
connectChat({
  card: document.querySelector('#experimente-chat'),
  endpoint: '/api/chat-demo',
  welcome: 'Olá! Sou o agente virtual da Clínica Exemplo, uma clínica de demonstração. Pergunte sobre horários, serviços, endereço ou como pedir uma consulta.'
});
