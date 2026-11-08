'use strict';
/* Atende.IA | chamados de suporte técnico (equipe da empresa -> administração do sistema).
   Atendimento: abre chamados e acompanha os da própria empresa (somente leitura).
   Admin: vê todos, filtra por status, muda o status e responde.
   Usa as funções globais de painel.js. Dados do usuário só entram por value e textContent. */
(()=>{
  const ROTULOS={aberto:'Aberto',em_andamento:'Em andamento',resolvido:'Resolvido'};

  function cartaoBase(c){
    const card=el('div',null,'item');
    const topo=el('p');topo.append(el('strong',`#${c.numero} • ${c.assunto}`),el('span','  '+(ROTULOS[c.status]||c.status),'status'));
    card.append(topo);
    return card;
  }

  // ---------------------------------------------------------------- atendimento
  async function carregarDaEmpresa(){
    const lista=$('#chamados-lista');
    try{
      const {items}=await api('/api/staff/chamados');
      lista.replaceChildren();
      if(!items.length){lista.append(el('p','Nenhum chamado aberto pela sua empresa.','muted'));return;}
      for(const c of items){
        const card=cartaoBase(c);
        card.append(el('p',`Aberto por ${c.abertoPor?.nome||'Não informado'} em ${date(c.criadoEm)} • Atualizado em ${date(c.atualizadoEm)}`,'muted fine'),
          el('p',c.descricao,'chamado-texto'));
        const resposta=el('div',null,'message');
        resposta.append(el('small','Resposta do suporte'),el('div',c.resposta||'Ainda sem resposta.'));
        card.append(resposta);
        lista.append(card);
      }
    }catch(err){lista.replaceChildren(el('p',err.message,'muted'));}
  }
  async function abrirChamado(e){
    e.preventDefault();
    const form=e.currentTarget,botao=form.querySelector('button.primary');
    botao.disabled=true;
    try{
      const {item}=await api('/api/staff/chamados','POST',{assunto:form.elements.assunto.value,descricao:form.elements.descricao.value});
      form.reset();
      feedback('#chamado-feedback',`Chamado #${item.numero} aberto. O suporte foi avisado.`,true);
      await carregarDaEmpresa();
    }catch(err){feedback('#chamado-feedback',err.message);}
    finally{botao.disabled=false;}
  }

  // ---------------------------------------------------------------- administração
  async function carregarTodos(){
    const lista=$('#chamados-admin-lista'),status=$('#chamados-filtro').value;
    try{
      const {items}=await api('/api/admin/chamados'+(status?'?status='+encodeURIComponent(status):''));
      lista.replaceChildren();
      if(!items.length){lista.append(el('p','Nenhum chamado encontrado.','muted'));return;}
      for(const c of items)lista.append(cartaoAdmin(c));
    }catch(err){lista.replaceChildren(el('p',err.message,'muted'));}
  }
  function cartaoAdmin(c){
    const card=cartaoBase(c);
    const quem=c.abertoPor?.usuario?`${c.abertoPor.nome} (${c.abertoPor.usuario})`:(c.abertoPor?.nome||'Não informado');
    card.append(el('p',`${c.empresa?.nome||'Empresa não encontrada'} • ${quem} • ${date(c.criadoEm)}`,'muted fine'),el('p',c.descricao,'chamado-texto'));
    const form=el('form',null,'stack');
    const rotuloStatus=el('label','Status'),seletor=document.createElement('select');
    for(const [valor,rotulo] of Object.entries(ROTULOS)){const o=el('option',rotulo);o.value=valor;seletor.append(o);}
    seletor.value=c.status;rotuloStatus.append(seletor);
    const rotuloResposta=el('label','Resposta ao atendimento'),texto=document.createElement('textarea');
    texto.maxLength=2000;texto.rows=3;texto.value=c.resposta||'';rotuloResposta.append(texto);
    const salvar=el('button','Salvar chamado','primary'),aviso=el('p',null,'notice');
    aviso.setAttribute('role','status');
    form.append(rotuloStatus,rotuloResposta,salvar,aviso);
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(!await verifyAdmin(`Salvar o chamado #${c.numero}`))return;
      salvar.disabled=true;
      try{
        await api(`/api/admin/chamados/${c.id}`,'PUT',{confirmed:true,status:seletor.value,resposta:texto.value});
        aviso.textContent='Chamado salvo.';aviso.classList.add('good');
        c.status=seletor.value;card.querySelector('.status').textContent='  '+(ROTULOS[c.status]||c.status);
      }catch(err){aviso.textContent=err.message;aviso.classList.remove('good');}
      finally{salvar.disabled=false;}
    });
    card.append(form);
    return card;
  }

  window.initChamados=async()=>{
    if(page==='atendimento'){
      // O admin não tem empresa própria: acompanha os chamados pela Administração.
      if(session.user.role==='admin'){
        show($('#chamado-form'),false);show($('#chamados-lista'),false);show($('#chamados-atualizar'),false);
        feedback('#chamado-feedback','Para ver os chamados de suporte, use a Administração.');
        return;
      }
      $('#chamado-form').addEventListener('submit',abrirChamado);
      $('#chamados-atualizar').addEventListener('click',carregarDaEmpresa);
      await carregarDaEmpresa();
    }
    if(page==='admin'){
      $('#chamados-filtro').addEventListener('change',carregarTodos);
      $('#chamados-admin-atualizar').addEventListener('click',carregarTodos);
      await carregarTodos();
    }
  };
})();
