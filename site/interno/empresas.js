/* Atende.IA v0.3.8 | empresas e assinaturas (sem integração financeira) */
'use strict';
window.atendeCompanies=[];
const ufs='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const states={em_configuracao:'Em configuração',ativa:'Ativa (cadastro)',pausada:'Pausada (cadastro)'};
const subStates={teste:'Em teste',ativa:'Ativa (manual)',atrasada:'Em atraso (manual)',suspensa:'Suspensa (manual)',cancelada:'Cancelada (manual)'};
const timezoneOptions={'America/Sao_Paulo':'Brasília (UTC-3)','America/Manaus':'Amazonas (UTC-4)','America/Rio_Branco':'Acre (UTC-5)','America/Noronha':'Fernando de Noronha (UTC-2)'};
let planDefinitions={};
function uiNode(tag,text,cls){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n;}
function inputField(label,key,value='',type='text',opts={}){
  const outer=uiNode('label'),control=uiNode('input');outer.append(uiNode('span',label));control.name=key;control.type=type;
  control.value=value??'';if(opts.required)control.required=true;
  if(opts.maxlength)control.maxLength=opts.maxlength;
  if(opts.step)control.step=opts.step;if(opts.min!==undefined)control.min=opts.min;
  outer.append(control);return outer;
}
function selectField(label,key,options,value){
  const outer=uiNode('label');outer.append(uiNode('span',label));const s=uiNode('select');s.name=key;
  for(const [id,name] of Object.entries(options)){const op=uiNode('option',name);op.value=id;op.selected=id===value;s.append(op);}outer.append(s);return outer;
}
function formValues(form){return Object.fromEntries(new FormData(form).entries());}
function brl(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function notifyCompany(msg,ok=false){const n=document.getElementById('companies-feedback');n.textContent=msg;n.classList.toggle('good',ok);}
function chooseCompanyOptions(){
  const select=document.getElementById('new-user-company');if(!select)return;
  const current=select.value;select.replaceChildren();
  const first=uiNode('option','Selecione uma empresa');first.value='';select.append(first);
  for(const c of window.atendeCompanies){const o=uiNode('option',`${c.name} • ${c.uf||'UF não informada'}`);o.value=c.id;select.append(o);}
  if(window.atendeCompanies.some(c=>c.id===current))select.value=current;
}
async function loadAtendeCompanies(){
  const r=await api('/api/admin/companies');window.atendeCompanies=r.items||[];chooseCompanyOptions();
  document.getElementById('companies-list').replaceChildren();
  for(const company of window.atendeCompanies) renderCompany(company);
  if(!window.atendeCompanies.length)document.getElementById('companies-list').append(uiNode('p','Nenhuma empresa cadastrada. Comece pelo formulário acima.','muted'));
}
async function saveCompany(form,id,name,action){
  const btn=form.querySelector('button[type="submit"]')||form.querySelector('button');btn.disabled=true;
  try{
    const pw=await verifyAdmin(action==='subscription'?`Alterar plano de ${name}`:`Editar cadastro de ${name}`);
    if(!pw)return;
    const data=formValues(form);data.currentPassword=pw;
    if(action==='subscription'){
      data.setupCents=Math.round(Number(data.setupReais.replace(',','.'))*100);
      data.monthlyCents=Math.round(Number(data.monthlyReais.replace(',','.'))*100);
      delete data.setupReais;delete data.monthlyReais;
    }
    await api(`/api/admin/companies/${id}/${action}`,'PUT',data);
    notifyCompany('Alterações salvas. Nenhuma cobrança foi executada.',true);
    await loadAtendeCompanies();await loadAudit();
  }catch(e){notifyCompany(e.message);}finally{btn.disabled=false;}
}
function renderCompany(c){
  const box=uiNode('article',null,'biz-company');const head=uiNode('div',null,'biz-head');
  const title=uiNode('h3',c.name);head.append(title,uiNode('span',`${c.city||'Cidade não informada'} / ${c.uf||'UF não informada'}`,'muted'));
  // O ID liga o número de WhatsApp à empresa (WHATSAPP_EMPRESA_ID no config-local.bat).
  box.append(head,uiNode('p',`ID da empresa: ${c.id}`,'biz-note'));
  const details=uiNode('form',null,'biz-form-grid');
  details.append(inputField('Nome da empresa','name',c.name,'text',{required:true,maxlength:100}));
  details.append(inputField('Cidade','city',c.city,'text',{required:true,maxlength:80}));
  details.append(selectField('UF','uf',Object.fromEntries(ufs.map(x=>[x,x])),c.uf||'SC'));
  details.append(selectField('Fuso horário','timeZone',timezoneOptions,c.timeZone||'America/Sao_Paulo'));
  details.append(inputField('Contato de teste','contact',c.contact,'text',{maxlength:120}));
  details.append(selectField('Situação do cadastro','state',states,c.state));
  details.append(inputField('Observações internas','notes',c.notes,'text',{maxlength:500}));
  const save=uiNode('button','Salvar dados da empresa','primary');save.type='submit';details.append(save);
  details.addEventListener('submit',e=>{e.preventDefault();saveCompany(details,c.id,c.name,'details');});box.append(details);
  const sub=c.subscription||{};const subform=uiNode('form',null,'biz-form-grid');
  subform.append(selectField('Plano','plan',Object.fromEntries(Object.entries(planDefinitions).map(([k,v])=>[k,v.label])),sub.plan||'essencial'));
  subform.append(selectField('Situação da assinatura','status',subStates,sub.status||'teste'));
  subform.append(inputField('Implantação (R$)','setupReais',(Number(sub.setupCents||0)/100).toFixed(2),'number',{required:true,step:'0.01',min:0}));
  subform.append(inputField('Mensalidade (R$)','monthlyReais',(Number(sub.monthlyCents||0)/100).toFixed(2),'number',{required:true,step:'0.01',min:0}));
  subform.append(inputField('Próximo vencimento (informativo)','nextDueDate',sub.nextDueDate||'','date'));
  const pay=uiNode('button','Salvar plano e vencimento','primary');pay.type='submit';subform.append(pay);
  subform.addEventListener('submit',e=>{e.preventDefault();saveCompany(subform,c.id,c.name,'subscription');});
  box.append(uiNode('p',`Assinatura demonstrativa. Implantação: ${brl(sub.setupCents)}. Mensalidade: ${brl(sub.monthlyCents)}. Situação: ${subStates[sub.status]||'Em teste'}.`,'biz-note'),subform);
  box.append(uiNode('p','Valores e vencimentos registrados manualmente. Sem pagamento automático, cobrança, disparo de mensagens ou suspensão de usuários.','biz-note'));
  document.getElementById('companies-list').append(box);
}
window.initAtendeCompanies=async function(){
  const u=document.getElementById('new-company-uf');for(const uf of ufs){const o=uiNode('option',uf);o.value=uf;u.append(o);}
  const r=await api('/api/admin/plans');planDefinitions=r.plans||{};
  document.getElementById('new-company').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const btn=form.querySelector('button[type="submit"]')||form.querySelector('button');btn.disabled=true;
    try{
      const pw=await verifyAdmin('Cadastrar nova empresa');if(!pw)return;
      await api('/api/admin/companies','POST',{...formValues(form),currentPassword:pw});
      form.reset();notifyCompany('Empresa cadastrada. Agora você pode criar usuários vinculados a ela.',true);
      await loadAtendeCompanies();await loadAudit();
    }catch(e){notifyCompany(e.message);}finally{btn.disabled=false;}
  });
  await loadAtendeCompanies();
};
