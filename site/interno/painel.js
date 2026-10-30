'use strict';
const page=document.body.dataset.page;
let session=null, currentRequest=null;
let navSecurityInProgress=false;
const $=s=>document.querySelector(s);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=String(text);if(cls)node.className=cls;return node;};
const labelStatus={novo:'Novo',em_andamento:'Em andamento',aguardando_cliente:'Aguardando cliente',resolvido:'Resolvido'};
const date=s=>s?new Date(s).toLocaleString('pt-BR'):'Não informado';
const show=(node,on=true)=>node?.classList.toggle('hidden',!on);
const feedback=(selector,msg,success=false)=>{const n=$(selector);if(n){n.textContent=msg;n.classList.toggle('good',success);}};
function fieldData(form){return Object.fromEntries(new FormData(form).entries());}
function linkFor(role){return role==='admin'?'/admin':role==='atendimento'?'/atendimento':'/cliente';}
// O olho alterna visibilidade sem enviar o formulário ou armazenar senhas.
function installPasswordToggles(){
  document.querySelectorAll('input[type="password"]').forEach(input=>{
    if(input.closest('.password-wrap'))return;
    const wrapper=document.createElement('span');wrapper.className='password-wrap';
    input.parentNode.insertBefore(wrapper,input);wrapper.append(input);
    const toggle=el('button',null,'password-visibility');
    toggle.type='button';toggle.setAttribute('aria-pressed','false');
    const eye=document.createElementNS('http://www.w3.org/2000/svg','svg');
    eye.setAttribute('viewBox','0 0 24 24');eye.setAttribute('aria-hidden','true');
    const iconPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    eye.append(iconPath);
    const words=el('span','Mostrar');toggle.append(eye,words);
    const update=visible=>{
      input.type=visible?'text':'password';
      toggle.setAttribute('aria-pressed',String(visible));
      toggle.setAttribute('aria-label',`${visible?'Ocultar':'Mostrar'} ${input.name==='newPassword'?'nova senha':input.name==='currentPassword'?'senha atual':'senha'}`);
      toggle.setAttribute('title',visible?'Ocultar senha':'Mostrar senha');
      words.textContent=visible?'Ocultar':'Mostrar';
      iconPath.setAttribute('d',visible
        ?'M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c5.4 0 9.5 7 9.5 7a16.9 16.9 0 0 1-3.4 3.9M6.3 6.3C3.9 8.1 2.5 12 2.5 12S6.6 19 12 19c1.6 0 3-.6 4.3-1.3M9.8 9.8a3 3 0 0 0 4.4 4.4'
        :'M2.5 12s4.1-7 9.5-7 9.5 7 9.5 7-4.1 7-9.5 7-9.5-7-9.5-7ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z');
    };
    update(false);toggle.addEventListener('click',()=>{
      const start=input.selectionStart,end=input.selectionEnd;
      update(input.type==='password');input.focus({preventScroll:true});
      try{input.setSelectionRange(start,end)}catch{}
    });
    wrapper.append(toggle);
  });
}
function hidePasswords(){
  document.querySelectorAll('.password-visibility[aria-pressed="true"]').forEach(b=>b.click());
}
// Ao sair, mascara a página antes que o navegador a guarde no histórico.
// Ao restaurá-la por Voltar/Avançar, revoga a sessão e exige novo login.
function installHistoryGuard(){
  if(page==='acesso')return;
  window.addEventListener('pagehide',()=>{
    document.body.classList.remove('authorized');
    hidePasswords();
  });
  window.addEventListener('pageshow',event=>{
    const navigation=performance.getEntriesByType('navigation')[0];
    if(event.persisted || navigation?.type==='back_forward'){
      requireLoginAfterHistoryNavigation();
    }
  });
}
async function requireLoginAfterHistoryNavigation(){
  if(navSecurityInProgress)return;navSecurityInProgress=true;
  document.body.classList.remove('authorized');
  try{
    // Em navegação restaurada sem cache, session ainda não foi carregada:
    // buscar CSRF válido ANTES de revogar a sessão do servidor.
    if(!session?.csrf)session=await api('/api/auth/me');
    if(session?.user)await api('/api/auth/logout','POST',{});
    session=null;
    location.replace('/acesso?retorno=historico');
  }catch(err){
    // Falha de rede? O conteúdo permanece oculto: nunca exibir um painel
    // restaurado sem a verificação e o encerramento da sessão.
    console.warn('Não foi possível encerrar sessão ao restaurar histórico:',err.message);
    session=null;
    document.body.replaceChildren(el('main','Não foi possível validar a sessão. Feche esta aba e abra /acesso novamente.','session-warning'));
    document.body.classList.add('authorized');
  }
}
async function api(path,method='GET',payload=null){
  const opts={method,headers:{}};
  if(payload!==null){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(payload);}
  if(method!=='GET'&&session?.csrf)opts.headers['X-CSRF-Token']=session.csrf;
  const resp=await fetch(path,opts);let data;
  try{data=await resp.json();}catch{throw Error('Resposta inválida do servidor.');}
  if(!resp.ok)throw Error(data.error||'Erro na solicitação.');
  return data;
}
async function init(){
  installPasswordToggles();
  installHistoryGuard();
  // Proteção imediata contra navegação Voltar/Avançar carregada sem bfcache.
  if(page!=='acesso' && performance.getEntriesByType('navigation')[0]?.type==='back_forward'){
    await requireLoginAfterHistoryNavigation();return;
  }
  session=await api('/api/auth/me');
  const user=session.user;
  if(page==='acesso'){
    if(user && !user.mustChangePassword){location.replace(linkFor(user.role));return;}
    show($('#login-form'),!user);show($('#change-form'),Boolean(user?.mustChangePassword));
    initLogin();return;
  }
  if(!user || user.mustChangePassword){location.replace('/acesso');return;}
  if(page==='admin' && user.role!=='admin' || page==='cliente' && user.role!=='cliente' || page==='atendimento' && !['admin','atendimento'].includes(user.role)) {location.replace(linkFor(user.role));return;}
  document.body.classList.add('authorized');
  $('#who').textContent=`${user.name} • ${user.role}`;
  if(user.role==='cliente'||user.role==='atendimento'){
    try{const own=await api('/api/my-company');$('#who').textContent+=` • ${own.name}`;}
    catch{} // O servidor continua protegendo as permissões.
  }
  $('#logout').addEventListener('click',async()=>{document.body.classList.remove('authorized');try{await api('/api/auth/logout','POST',{});}finally{session=null;location.replace('/acesso');}});
  $('#change-password').addEventListener('click',()=>{hidePasswords();$('#password-dialog').showModal();});
  $('#close-password').addEventListener('click',()=>{hidePasswords();$('#password-dialog').close();});
  $('#password-form').addEventListener('submit',async e=>{
    e.preventDefault();const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
    try{await api('/api/auth/change-password','POST',fieldData(e.currentTarget));alert('Senha atualizada. Entre novamente com sua nova senha.');location.replace('/acesso');}
    catch(err){feedback('#password-feedback',err.message);}finally{btn.disabled=false;}
  });
  if(page==='cliente')await initClient();
  if(page==='atendimento')await initStaff();
  if(page==='admin')await initAdmin();
}
// Formulários de login e primeiro acesso ficam na mesma URL.
// "Voltar ao login" cancela a sessão provisória NO SERVIDOR, não apenas oculta campos.
function initLogin(){
  const loginForm=$('#login-form'),changeForm=$('#change-form');
  function displayLogin(message='',success=false){
    loginForm.reset();changeForm.reset();hidePasswords();
    show(changeForm,false);show(loginForm,true);
    feedback('#notice',message,success);
    loginForm.querySelector('input[name="username"]').focus({preventScroll:true});
  }
  loginForm.addEventListener('submit',async e=>{
    e.preventDefault();const btn=loginForm.querySelector('button[type="submit"]');
    if(!btn){feedback('#notice','Não foi possível localizar o botão de entrada. Atualize a página.');return;}
    btn.disabled=true;feedback('#notice','Verificando acesso...');
    try{
      session=await api('/api/auth/login','POST',fieldData(loginForm));
      if(session.user.mustChangePassword){
        hidePasswords();loginForm.reset();changeForm.reset();
        show(loginForm,false);show(changeForm,true);
        feedback('#notice','Por segurança, troque a senha provisória. Se preferir, volte ao login para trocar de usuário.');
      }else location.replace(linkFor(session.user.role));
    }catch(err){feedback('#notice',err.message);}finally{btn.disabled=false;}
  });
  // Permite sair do primeiro acesso, mesmo se o usuário esqueceu a senha provisória.
  $('#back-to-login').addEventListener('click',async e=>{
    const btn=e.currentTarget;btn.disabled=true;
    feedback('#notice','Encerrando sessão provisória...');
    try{
      // Busca CSRF se a tela foi recarregada durante a troca de senha.
      if(!session?.csrf)session=await api('/api/auth/me');
      if(session?.user)await api('/api/auth/logout','POST',{});
      session=null;
      displayLogin('Sessão encerrada. Entre com outra conta ou com sua senha provisória.',true);
    }catch(err){
      // Se o logout falhar, não mostre o formulário normal como se a conta tivesse saído.
      feedback('#notice','Não foi possível encerrar a sessão. Verifique a conexão e tente novamente.');
    }finally{btn.disabled=false;}
  });
  changeForm.addEventListener('submit',async e=>{
    e.preventDefault();const btn=changeForm.querySelector('button[type="submit"]');
    if(!btn){feedback('#notice','Não foi possível localizar o botão para salvar a senha. Atualize a página.');return;}
    btn.disabled=true;feedback('#notice','Salvando nova senha...');
    try{
      await api('/api/auth/change-password','POST',fieldData(changeForm));
      session=null; // servidor revoga todas as sessões da conta ao concluir a troca
      displayLogin('Senha alterada com sucesso. Entre novamente com sua nova senha.',true);
    }catch(err){feedback('#notice',err.message);}finally{btn.disabled=false;}
  });
}
function requestItem(item,click,selected=false){
  const outer=el('div',null,'item'+(selected?' selected':''));outer.dataset.id=item.id;
  const button=el('button');button.type='button';button.append(el('strong',item.subject),el('span','  '+(labelStatus[item.status]||item.status),'status'));
  outer.append(button,el('p',`${item.customerName?item.customerName+' • ':''}${date(item.updatedAt)}${item.priority?' • Prioridade '+item.priority:''}`));
  button.addEventListener('click',click);return outer;
}
function renderDetail(container,item){
  container.replaceChildren();container.append(el('h3',item.subject),el('p',`Solicitação: ${item.id}`,'muted fine'),el('p',`Cliente: ${item.customerName} • Aberta em ${date(item.createdAt)}`,'muted'));
  container.append(el('p',`Status: ${labelStatus[item.status]} • Prioridade: ${item.priority} • Responsável: ${item.assignedTo||'não atribuído'}`,'muted'));
  const heading=el('h3','Histórico de mensagens');container.append(heading);
  if(!item.messages.length)container.append(el('p','Nenhuma mensagem ainda.','muted'));
  item.messages.forEach(m=>{const box=el('div',null,'message'+(m.internal?' internal':''));
    box.append(el('small',`${m.author} • ${date(m.createdAt)}${m.internal?' • NOTA INTERNA':''}`),el('div',m.content));container.append(box);
  });
}
async function initClient(){
  $('#new-request').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
    try{const result=await api('/api/portal/requests','POST',fieldData(form));form.reset();feedback('#new-feedback','Solicitação registrada.',true);await loadClientList(result.item.id);}
    catch(err){feedback('#new-feedback',err.message);}finally{btn.disabled=false;}
  });
  $('#reply-form').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentRequest)return;
    const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
    try{const result=await api(`/api/portal/requests/${currentRequest}`+'/messages','POST',fieldData(form));form.reset();renderDetail($('#request-detail'),result.item);await loadClientList(currentRequest);feedback('#reply-feedback','Mensagem enviada.',true);}
    catch(err){feedback('#reply-feedback',err.message);}finally{btn.disabled=false;}
  });
  await loadClientList();
}
async function loadClientList(selected=null){
  const items=(await api('/api/portal/requests')).items;const list=$('#request-list');list.replaceChildren();
  if(!items.length)list.append(el('p','Você ainda não possui solicitações.','muted'));
  items.slice().reverse().forEach(item=>list.append(requestItem(item,()=>openClient(item.id),item.id===(selected||currentRequest))));
  if(selected)await openClient(selected);
}
async function openClient(id){
  const {item}=await api(`/api/portal/requests/${id}`);currentRequest=id;
  renderDetail($('#request-detail'),item);show($('#reply-form'),true);feedback('#reply-feedback','');
  markSelected('#request-list',id);
}
function markSelected(listSelector,id){
  [...$(listSelector).children].forEach(x=>x.classList.toggle('selected',x.dataset.id===id));
}
async function initStaff(){
  if(session.user.role==='admin')show($('.admin-only'),true);
  $('#refresh').addEventListener('click',refreshStaff);
  $('#search').addEventListener('input',()=>{clearTimeout(window.searchDelay);window.searchDelay=setTimeout(loadStaffList,250);});
  $('#filter-status').addEventListener('change',loadStaffList);
  $('#status').addEventListener('change',e=>modifyRequest('status',e.target.value));
  $('#priority').addEventListener('change',e=>modifyRequest('priority',e.target.value));
  $('#assign').addEventListener('click',()=>modifyRequest('assign','me'));
  $('#templates').addEventListener('click',e=>{const btn=e.target.closest('button[data-reply]');if(btn)$('#staff-reply textarea').value=btn.dataset.reply;});
  $('#staff-reply').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentRequest)return;
    const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
    try{const data=fieldData(form);data.internal=Boolean(data.internal);
      const result=await api(`/api/staff/requests/${currentRequest}/messages`,'POST',data);renderDetail($('#staff-detail'),result.item);
      form.reset();feedback('#staff-feedback',data.internal?'Nota interna registrada.':'Resposta registrada.',true);await loadStaffList();}
    catch(err){feedback('#staff-feedback',err.message);}finally{btn.disabled=false;}
  });
  $('#show-leads').addEventListener('click',async()=>{
    const target=$('#leads');show(target,target.classList.contains('hidden'));if(target.classList.contains('hidden'))return;
    target.replaceChildren();
    try{const {items}=await api('/api/staff/leads');if(!items.length)target.append(el('p','Nenhum lead de demonstração.','muted'));
      items.forEach(x=>{const card=el('div',null,'item');card.append(el('strong',`${x.kind} • ${x.name||'Teste'}`),el('p',`Empresa/cidade: ${x.company||x.city||'Não informado'} • ${date(x.createdAt)}`),el('p',`Contato: ${x.phone||x.contact||'Não informado'} • ${x.service||x.need||''}`));target.append(card);});
    }catch(err){target.append(el('p',err.message));}
  });
  await refreshStaff();
  await initWhatsApp();
}
async function refreshStaff(){
  const stats=await api('/api/staff/stats');const target=$('#stats');target.replaceChildren();
  [['Total',stats.total],['Novas',stats.novo],['Em andamento',stats.em_andamento],['Aguardando cliente',stats.aguardando_cliente],['Resolvidas',stats.resolvido]].forEach(([name,num])=>{
    const card=el('div',null,'stat');card.append(el('b',num),el('span',name));target.append(card);
  });
  await loadStaffList();
}
async function loadStaffList(){
  const search=encodeURIComponent($('#search').value),status=encodeURIComponent($('#filter-status').value);
  const {items}=await api(`/api/staff/requests?search=${search}&status=${status}`);
  const list=$('#staff-list');list.replaceChildren();
  if(!items.length)list.append(el('p','Nenhuma solicitação encontrada.','muted'));
  items.forEach(x=>list.append(requestItem(x,()=>openStaff(x.id),x.id===currentRequest)));
}
async function openStaff(id){
  const {item}=await api(`/api/staff/requests/${id}`);currentRequest=id;
  renderDetail($('#staff-detail'),item);show($('#staff-actions'),true);
  $('#status').value=item.status;$('#priority').value=item.priority;
  $('#assign').textContent=item.assignedTo?`Assumir (atual: ${item.assignedTo})`:'Assumir';feedback('#staff-feedback','');
  markSelected('#staff-list',id);
}
async function modifyRequest(action,value){
  if(!currentRequest)return;
  try{const {item}=await api(`/api/staff/requests/${currentRequest}/${action}`,'POST',{value});
    await openStaff(item.id);await refreshStaff();feedback('#staff-feedback','Solicitação atualizada.',true);
  }catch(err){feedback('#staff-feedback',err.message);await openStaff(currentRequest);}
}
// Conversas do WhatsApp: o robô responde até um atendente assumir; depois a pessoa responde por aqui.
let currentChat=null,chatLoading=false;
const chatAuthor={cliente:'Cliente',robo:'Robô',atendente:'Atendente'};
const phone=n=>n?'+'+n:'';
async function initWhatsApp(){
  const {enabled}=await api('/api/staff/whatsapp');
  if(!enabled)return;
  show($('#wpp-box'),true);
  $('#wpp-take').addEventListener('click',()=>chatAction('assumir'));
  $('#wpp-release').addEventListener('click',()=>chatAction('devolver'));
  $('#wpp-reply').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentChat)return;
    const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
    try{const {item}=await api(`/api/staff/whatsapp/${currentChat}/mensagens`,'POST',{texto:form.texto.value});
      form.reset();renderChat(item);await loadChats();feedback('#wpp-feedback','Mensagem enviada pelo WhatsApp.',true);}
    catch(err){feedback('#wpp-feedback',err.message);}finally{btn.disabled=false;}
  });
  await refreshChats();
  // Novas mensagens chegam pelo webhook; a tela confere a cada 10 segundos.
  setInterval(refreshChats,10_000);
}
async function refreshChats(){
  if(chatLoading||document.hidden)return;chatLoading=true;
  try{await loadChats();if(currentChat)await openChat(currentChat,false);$('#wpp-status').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR');}
  catch(err){$('#wpp-status').textContent='Falha ao atualizar: '+err.message;}
  finally{chatLoading=false;}
}
async function loadChats(){
  const {items}=await api('/api/staff/whatsapp');const list=$('#wpp-list');list.replaceChildren();
  if(!items.length)list.append(el('p','Nenhuma conversa ainda.','muted'));
  items.forEach(c=>{
    const outer=el('div',null,'item'+(c.id===currentChat?' selected':''));outer.dataset.id=c.id;
    const button=el('button');button.type='button';
    button.append(el('strong',c.nome||phone(c.telefone)),el('span',c.modo==='humano'?'Com '+(c.atendente||'atendente'):'Robô','status'));
    if(c.pedidoAtendente)button.append(el('span','Pediu atendente','status wpp-alert'));
    outer.append(button,el('p',`${c.nome?phone(c.telefone)+' • ':''}${date(c.atualizadoEm)}${c.ultima?' • '+chatAuthor[c.ultima.de]+': '+c.ultima.texto:''}`));
    button.addEventListener('click',()=>openChat(c.id));list.append(outer);
  });
}
async function openChat(id,clearFeedback=true){
  const {item}=await api(`/api/staff/whatsapp/${id}`);currentChat=id;
  renderChat(item);if(clearFeedback)feedback('#wpp-feedback','');markSelected('#wpp-list',id);
}
function renderChat(c){
  const box=$('#wpp-detail'),old=box.querySelector('.wpp-messages');
  // Rola até o fim ao abrir, quando chega mensagem nova ou se já estava no fim; senão preserva a leitura.
  const sameChat=old&&old.dataset.chat===c.id,before=sameChat?Number(old.dataset.count):0;
  const atBottom=!sameChat||c.mensagens.length>before||old.scrollTop+old.clientHeight>=old.scrollHeight-20;
  const keepScroll=sameChat?old.scrollTop:0;
  box.classList.remove('muted');
  box.replaceChildren(el('h3',c.nome||phone(c.telefone)),el('p',`${phone(c.telefone)} • ${c.modo==='humano'?'Atendimento humano: '+(c.atendente||''):'Robô respondendo'}`,'muted'));
  const msgs=el('div',null,'wpp-messages');msgs.dataset.chat=c.id;msgs.dataset.count=String(c.mensagens.length);
  c.mensagens.forEach(m=>{const b=el('div',null,'message wpp-'+m.de);b.append(el('small',`${m.de==='atendente'?m.autor:chatAuthor[m.de]} • ${date(m.em)}`),el('div',m.texto));msgs.append(b);});
  box.append(msgs);msgs.scrollTop=atBottom?msgs.scrollHeight:keepScroll;
  show($('#wpp-actions'),true);
  const human=c.modo==='humano';
  show($('#wpp-take'),!human);show($('#wpp-release'),human);
  show($('#wpp-reply'),human&&c.janelaAberta);
  $('#wpp-window').textContent=c.janelaAberta
    ?`Pode responder com texto livre até ${date(c.janelaFechaEm)} (24 h após a última mensagem do cliente).`
    :'Passaram 24 h desde a última mensagem do cliente: a Meta só permite responder com modelo aprovado.';
}
async function chatAction(action){
  if(!currentChat)return;
  try{const {item}=await api(`/api/staff/whatsapp/${currentChat}/${action}`,'POST',{});renderChat(item);await loadChats();
    feedback('#wpp-feedback',action==='assumir'?'Você assumiu a conversa: o robô parou de responder este cliente.':'Conversa devolvida ao robô.',true);}
  catch(err){feedback('#wpp-feedback',err.message);}
}
// Reautenticação visual com campo password: nunca usa window.prompt (texto visível).
function verifyAdmin(action){
  const dialog=$('#admin-verify-dialog'),form=$('#admin-verify-form'),input=$('#admin-verify-password');
  $('#admin-verify-description').textContent=`Confirme sua senha para: ${action}.`;
  form.reset();hidePasswords();
  return new Promise(resolve=>{
    let finished=false;
    const detach=()=>{form.removeEventListener('submit',submit);dialog.removeEventListener('close',closed);};
    const finish=value=>{if(finished)return;finished=true;detach();dialog.close();input.value='';hidePasswords();resolve(value);};
    const submit=e=>{e.preventDefault();finish(input.value||null);};
    const closed=()=>{if(finished)return;finished=true;detach();input.value='';resolve(null);};
    form.addEventListener('submit',submit);dialog.addEventListener('close',closed);
    // Cancelar resolve direto; o evento close cobre a tecla Esc.
    $('#admin-verify-cancel').onclick=()=>finish(null);
    dialog.showModal();input.focus();
  });
}
async function initAdmin(){
  $('#create-user').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
    try{const result=await api('/api/admin/users','POST',fieldData(form));showTemporary(result.temporaryPassword,result.user.username);form.reset();feedback('#users-feedback','Usuário criado. Entregue a senha provisória com segurança.',true);await loadUsers();}
    catch(err){feedback('#users-feedback',err.message);}finally{btn.disabled=false;}
  });
  $('#config-form').addEventListener('submit',async e=>{
    e.preventDefault();const data=fieldData(e.currentTarget);data.services=data.services.split('\n').map(x=>x.trim()).filter(Boolean);
    const password=await verifyAdmin('Alterar os dados da empresa');if(!password)return;
    data.currentPassword=password;
    try{await api('/api/admin/config','PUT',data);feedback('#config-feedback','Configuração salva. Reabra a página pública para ver o novo conteúdo.',true);}
    catch(err){feedback('#config-feedback',err.message);}
  });
  $('#refresh-audit').addEventListener('click',loadAudit);
  $('#refresh-security').addEventListener('click',loadSecurity);
  await Promise.all([window.initAtendeCompanies?.()||Promise.resolve(),loadConfig(),loadAudit(),loadHealth(),loadSecurity()]);
  await loadUsers();
}
function showTemporary(password,username){
  const box=$('#generated-password');box.replaceChildren();
  box.append(el('strong',`Senha temporária de ${username} (exibida uma única vez):`),el('p',password));
  const copy=el('button','Copiar senha','ghost');copy.type='button';copy.addEventListener('click',()=>navigator.clipboard?.writeText(password));box.append(copy);
  box.append(el('p','Envie por um canal seguro; a senha deve ser trocada no primeiro login.','muted fine'));show(box,true);
}
async function adminAction(user,action,payload){
  const currentPassword=await verifyAdmin(`${action==='reset'?'Redefinir senha de':action==='status'?'Alterar acesso de':'Alterar perfil de'} ${user.username}`);
  if(!currentPassword)return false;
  try{const data=await api(`/api/admin/users/${user.id}/${action}`,'POST',{currentPassword,...payload});
    if(data.temporaryPassword){showTemporary(data.temporaryPassword,user.username);$('#generated-password').scrollIntoView({behavior:'smooth',block:'center'});}
    feedback('#users-feedback','Alteração realizada.',true);await Promise.all([loadUsers(),loadSecurity(),loadAudit()]);return true;}
  catch(err){feedback('#users-feedback',err.message);return false;}
}
async function loadUsers(){
  const {items}=await api('/api/admin/users');const container=$('#users-list');container.replaceChildren();
  items.forEach(u=>{
    const row=el('div',null,'item userbar'),left=el('div');left.append(el('strong',`${u.name} (${u.username})`),el('p',`${u.role}${u.companyId?' • Empresa vinculada: '+(window.atendeCompanies?.find(c=>c.id===u.companyId)?.name||'ID '+u.companyId.slice(0,8)):' • Sem empresa'} • ${u.active?'Ativo':'Desativado'}${u.mustChangePassword?' • troca de senha pendente':''}`));
    const controls=el('div',null,'mini-actions');
    if(u.id!==session.user.id && u.role!=='admin'){
      const reset=el('button','Redefinir senha');reset.onclick=()=>adminAction(u,'reset',{});controls.append(reset);
      const block=el('button',u.active?'Bloquear':'Reativar');block.onclick=()=>adminAction(u,'status',{active:!u.active});controls.append(block);
      const role=el('select');['cliente','atendimento'].forEach(r=>{const op=el('option',r);op.value=r;op.selected=r===u.role;role.append(op);});
      // Cancelar ou falhar a confirmação devolve o select ao perfil salvo.
      role.addEventListener('change',async()=>{const next=role.value;if(!await adminAction(u,'role',{role:next}))role.value=u.role;});controls.append(role);
      const companySelect=el('select');companySelect.setAttribute('aria-label',`Empresa de ${u.username}`);
      if(!u.companyId){const none=el('option','Sem empresa vinculada');none.value='';none.disabled=true;none.selected=true;companySelect.append(none);}
      (window.atendeCompanies||[]).forEach(c=>{const o=el('option',c.name);o.value=c.id;o.selected=c.id===u.companyId;companySelect.append(o);});
      companySelect.addEventListener('change',async()=>{
        const password=await verifyAdmin(`Vincular ${u.username} à empresa selecionada`);
        if(!password){companySelect.value=u.companyId||'';return;}
        try{await api(`/api/admin/users/${u.id}/company`,'PUT',{companyId:companySelect.value,currentPassword:password});await loadUsers();feedback('#users-feedback','Empresa vinculada. Sessões anteriores encerradas.',true);}
        catch(err){feedback('#users-feedback',err.message);companySelect.value=u.companyId||'';}
      });controls.append(companySelect);
    }
    row.append(left,controls);container.append(row);
  });
}
async function loadConfig(){
  const {config}=await api('/api/admin/config');const form=$('#config-form');
  Object.entries(config).forEach(([key,value])=>{const field=form.elements.namedItem(key);if(field)field.value=Array.isArray(value)?value.join('\n'):value;});
}
async function loadAudit(){
  const {items}=await api('/api/admin/audit'),container=$('#audit');container.replaceChildren();
  if(!items.length)container.append(el('p','Nenhuma ação registrada.','muted'));
  items.forEach(x=>{const row=el('div',null,'item');row.append(el('strong',x.action),el('p',`${date(x.at)} • ${x.actor}${x.detail?' • '+x.detail:''}`));container.append(row);});
}
async function loadSecurity(){
  const {blocked,events,summary}=await api('/api/admin/security');
  const target=$('#security-stats');target.replaceChildren();
  [['Bloqueadas agora',summary.locked],['Falhas (24h)',summary.failed],['Tentativas bloqueadas (24h)',summary.blockedAttempts],['Entradas bem-sucedidas (24h)',summary.successful]].forEach(([label,num],i)=>{
    const card=el('div',null,'security-stat'+(i<3?' alert':''));card.append(el('b',num),el('span',label));target.append(card);
  });
  const blockedList=$('#security-lockouts');blockedList.replaceChildren();
  if(!blocked.length)blockedList.append(el('p','Nenhuma conta está temporariamente bloqueada.','muted'));
  blocked.forEach(lock=>{
    const card=el('div',null,'item security-row'),info=el('div');
    info.append(el('strong',`${lock.name} (${lock.username})`),el('p',`Bloqueada até ${date(lock.until)} • ${lock.attempts} tentativas`));
    const actions=el('div',null,'mini-actions');
    if(lock.id){
      const unlock=el('button','Desbloquear agora');unlock.type='button';unlock.addEventListener('click',()=>unlockAccount(lock.username));actions.append(unlock);
      const reset=el('button','Redefinir senha');reset.type='button';reset.addEventListener('click',()=>adminAction({id:lock.id,username:lock.username},'reset',{}));actions.append(reset);
    }
    else info.append(el('p','Login desconhecido. Sem conta cadastrada para liberar.','muted'));
    card.append(info,actions);blockedList.append(card);
  });
  const table=$('#login-events');table.replaceChildren();
  if(!events.length){const tr=el('tr'),td=el('td','Nenhuma tentativa registrada.');td.colSpan=4;tr.append(td);table.append(tr);}
  const descriptions={sucesso:'Acesso autorizado',falha:'Credenciais incorretas',bloqueado:'Acesso bloqueado',desbloqueio:'Liberação manual'};
  events.forEach(x=>{
    const tr=el('tr');tr.append(el('td',date(x.at)),el('td',x.username));
    tr.append(el('td',descriptions[x.result]||x.result,'result-tag '+x.result),el('td',x.reason||'Não informado'));table.append(tr);
  });
}
async function unlockAccount(username){
  const currentPassword=await verifyAdmin(`Desbloquear a conta ${username}`);if(!currentPassword)return;
  try{
    const value=await api('/api/admin/security/unlock','POST',{username,currentPassword});
    feedback('#security-feedback',value.unlocked?`Conta ${username} liberada. O usuário já pode tentar novamente.`:`A conta ${username} já estava liberada.`,true);
    await Promise.all([loadSecurity(),loadAudit()]);
  }catch(err){feedback('#security-feedback',err.message);}
}
async function loadHealth(){
  const info=await api('/api/admin/health'),container=$('#health');container.replaceChildren();
  Object.entries(info).forEach(([key,value])=>{const row=el('div',null,'item');row.append(el('strong',key),el('p',String(value)));container.append(row);});
}
init().catch(err=>{
  // Antes da autorização o painel fica invisível; mostra só o aviso, sem revelar o conteúdo.
  if(page!=='acesso'&&!document.body.classList.contains('authorized')){
    document.body.replaceChildren(el('main',`Erro ao abrir o painel (${err.message}). Atualize a página ou abra /acesso novamente.`,'session-warning'));
    document.body.classList.add('authorized');return;
  }
  const notice=$('#notice')||$('#staff-detail')||$('#request-detail')||$('#users-feedback');if(notice)notice.textContent='Erro ao abrir o painel: '+err.message;
});
