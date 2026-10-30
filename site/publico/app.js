'use strict';
const chat = document.querySelector('#chat');
const form = document.querySelector('#chat-form');
const messageInput = document.querySelector('#message');
const sendButton = document.querySelector('#send');
const modeBanner = document.querySelector('#mode');
const mascot = document.querySelector('.avatar');
const demoDialog = document.querySelector('#lead-dialog');
const commercialDialog = document.querySelector('#commercial-dialog');
let history = [];
let busy = false;
let requestId = 0;
let activeController = null;
let company = {
  name: 'Empresa de exemplo', assistantName: 'Assistente de demonstração',
  serviceArea: 'Área de atendimento de exemplo',
  welcome: 'Olá! Esta é uma demonstração de atendimento. Você pode perguntar sobre serviços, região atendida e solicitações de orçamento.'
};

function bubble(text, who, extraClass = '') {
  const node = document.createElement('div');
  node.className = `message ${who} ${extraClass}`.trim();
  // Somente texto: não renderizar HTML recebido da IA ou do visitante.
  node.textContent = text;
  chat.append(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}
function reset() {
  requestId++;
  activeController?.abort();
  activeController = null;
  busy = false;
  mascot?.classList.remove('thinking');
  sendButton.disabled = false;
  history = [];
  chat.replaceChildren();
  bubble(company.welcome, 'agent');
  messageInput.value = '';
}
async function ask(text) {
  const message = text.trim();
  if (!message || busy) return;
  const myRequest = ++requestId;
  busy = true;
  mascot?.classList.add('thinking');
  sendButton.disabled = true;
  bubble(message, 'visitor');
  const loading = bubble('', 'agent', 'pending');
  loading.setAttribute('aria-label', 'Preparando resposta');
  const typing = document.createElement('span');
  typing.className = 'typing-dots';
  typing.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) typing.append(document.createElement('i'));
  const sr = document.createElement('span');
  sr.className = 'sr-only'; sr.textContent = 'Preparando resposta…';
  loading.append(typing, sr);
  const controller = new AbortController();
  activeController = controller;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível responder.');
    if (myRequest !== requestId) return;
    loading.textContent = result.answer;
    loading.classList.remove('pending');
    loading.removeAttribute('aria-label');
    history.push({ role: 'user', text: message }, { role: 'assistant', text: result.answer });
    history = history.slice(-8);
  } catch (error) {
    if (myRequest !== requestId) return;
    loading.textContent = `Não consegui responder agora. ${error.message}`;
    loading.classList.remove('pending');
    loading.removeAttribute('aria-label');
  } finally {
    if (myRequest === requestId) {
      busy = false;
      mascot?.classList.remove('thinking');
      activeController = null;
      sendButton.disabled = false;
      messageInput.focus();
      chat.scrollTop = chat.scrollHeight;
    }
  }
}
function configureCompany(data) {
  if (!data || typeof data !== 'object') return;
  company = { ...company, ...data };
  document.querySelector('#assistant-name').textContent = company.assistantName;
  document.querySelector('#company-proof').textContent = company.name;
  document.querySelector('#company-area').textContent = company.serviceArea;
  reset();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const message = messageInput.value;
  if (!message.trim() || busy) return;
  messageInput.value = '';
  ask(message);
});
document.querySelectorAll('[data-msg]').forEach(button => button.addEventListener('click', () => ask(button.dataset.msg)));
document.querySelector('#restart').addEventListener('click', reset);

function attachDialog(dialog, openerIds, closeId) {
  openerIds.forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.showModal()));
  document.querySelector(`#${closeId}`).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}
attachDialog(demoDialog, ['open-lead'], 'close-lead');
attachDialog(commercialDialog, ['open-commercial', 'open-commercial-hero'], 'close-commercial');

function connectForm(formSelector, feedbackSelector, endpoint, successMessage) {
  const leadForm = document.querySelector(formSelector);
  const feedback = document.querySelector(feedbackSelector);
  leadForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = leadForm.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(leadForm).entries());
    data.consent = Boolean(data.consent);
    feedback.textContent = '';
    feedback.classList.remove('ok');
    button.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o teste.');
      feedback.textContent = successMessage;
      feedback.classList.add('ok');
      leadForm.reset();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
connectForm('#lead-form', '#lead-feedback', '/api/lead', 'Teste salvo neste computador, em data/leads-demonstracao.json. Nenhum contato foi enviado.');
connectForm('#commercial-form', '#commercial-feedback', '/api/commercial-lead', 'Simulação comercial salva em data/interesses-comerciais-teste.json. Nenhuma mensagem foi enviada à equipe.');

fetch('/api/company')
  .then(response => { if (!response.ok) throw new Error('Configuração indisponível'); return response.json(); })
  .then(configureCompany)
  .catch(() => { /* O chat segue utilizável com conteúdo de exemplo. */ });
fetch('/api/status')
  .then(response => { if (!response.ok) throw new Error('Servidor indisponível'); return response.json(); })
  .then(status => {
    modeBanner.textContent = status.ai
      ? 'Modelo de IA conectado. Ambiente de demonstração.'
      : 'Demonstração com respostas programadas. Nenhuma IA conectada.';
    modeBanner.classList.toggle('live', status.ai);
  })
  .catch(() => { modeBanner.textContent = 'Servidor indisponível. Recarregue a página.'; });
reset();

// Layout estático e sem animações ligadas ao cursor ou à rolagem.
// A conversa e os formulários continuam funcionais.
