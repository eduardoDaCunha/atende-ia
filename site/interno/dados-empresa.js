'use strict';
/* Atende.IA | dados da empresa: horário, endereço, serviços com preço e perguntas frequentes.
   Usa as funções globais de painel.js. Dados do usuário só entram por value e textContent.
   O servidor decide a empresa: o atendimento só alcança a própria; o seletor existe só no admin. */
(()=>{
  const LIMITE_SERVICOS=30,LIMITE_PERGUNTAS=15;
  let empresaAtual=null,pedidoAtual=0,pronto=false;

  function campo(rotulo,chave,max,valor,tag='input',dica=''){
    const label=el('label',rotulo),controle=document.createElement(tag);
    controle.dataset.campo=chave;controle.maxLength=max;controle.value=valor||'';
    if(tag==='textarea')controle.rows=3;
    if(dica)controle.placeholder=dica;
    label.append(controle);return label;
  }
  function criarLinha(lista,classe,campos,limite,botao,textoRemover){
    const linha=el('div',null,classe),remover=el('button',textoRemover,'ghost');
    remover.type='button';
    remover.addEventListener('click',()=>{
      linha.remove();
      if(!lista.children.length)lista.append(lista.novaLinha());
      botao.disabled=lista.children.length>=limite;
    });
    linha.append(...campos,remover);
    return linha;
  }
  function montarListas(){
    const servicos=$('#dados-servicos'),perguntas=$('#dados-perguntas');
    const novoServico=$('#dados-novo-servico'),novaPergunta=$('#dados-nova-pergunta');
    servicos.novaLinha=(item={})=>criarLinha(servicos,'dados-linha',[
      campo('Serviço','nome',90,item.nome),
      campo('Preço','preco',60,item.preco,'input','Ex.: R$ 80,00 ou sob consulta')
    ],LIMITE_SERVICOS,novoServico,'Remover');
    perguntas.novaLinha=(item={})=>criarLinha(perguntas,'dados-linha dados-pergunta',[
      campo('Pergunta','pergunta',150,item.pergunta),
      campo('Resposta','resposta',400,item.resposta,'textarea')
    ],LIMITE_PERGUNTAS,novaPergunta,'Remover');
    for(const [botao,lista,limite] of [[novoServico,servicos,LIMITE_SERVICOS],[novaPergunta,perguntas,LIMITE_PERGUNTAS]]){
      botao.addEventListener('click',()=>{
        if(lista.children.length>=limite)return;
        const linha=lista.novaLinha();lista.append(linha);
        botao.disabled=lista.children.length>=limite;
        linha.querySelector('[data-campo]').focus();
      });
    }
  }
  function preencherLista(lista,botao,itens,limite){
    lista.replaceChildren(...(itens.length?itens:[{}]).map(item=>lista.novaLinha(item)));
    botao.disabled=lista.children.length>=limite;
  }
  function preencher(d){
    const form=$('#dados-empresa-form');
    form.elements.horario.value=d.horario||'';
    form.elements.endereco.value=d.endereco||'';
    preencherLista($('#dados-servicos'),$('#dados-novo-servico'),d.servicos||[],LIMITE_SERVICOS);
    preencherLista($('#dados-perguntas'),$('#dados-nova-pergunta'),d.perguntas||[],LIMITE_PERGUNTAS);
    $('#dados-empresa-atualizacao').textContent=d.atualizadaEm?`Última alteração: ${date(d.atualizadaEm)}`:'Ainda não preenchido.';
  }
  const lerLista=seletor=>[...$(seletor).children].map(linha=>Object.fromEntries(
    [...linha.querySelectorAll('[data-campo]')].map(c=>[c.dataset.campo,c.value])));
  const mostrarCampos=on=>show($('#dados-empresa-campos'),on);

  // Uma resposta atrasada de outra empresa nunca substitui a escolhida agora.
  async function carregar(empresa){
    const pedido=++pedidoAtual;
    empresaAtual=null;
    mostrarCampos(false);
    const consulta=page==='admin'?'?empresa='+encodeURIComponent(empresa):'';
    try{
      const {dados,companyId}=await api('/api/staff/dados-empresa'+consulta);
      if(pedido!==pedidoAtual)return;
      preencher(dados);empresaAtual=companyId;mostrarCampos(true);
    }catch(err){if(pedido===pedidoAtual)feedback('#dados-empresa-feedback',err.message);}
  }
  async function carregarEmpresas(){
    const seletor=$('#dados-empresa-seletor'),escolhida=seletor.value;
    const {items}=await api('/api/admin/companies');
    const vazia=el('option',items.length?'Escolha a empresa':'Nenhuma empresa cadastrada');
    vazia.value='';vazia.disabled=true;
    seletor.replaceChildren(vazia,...items.map(c=>{const o=el('option',c.name);o.value=c.id;return o;}));
    seletor.value=items.some(c=>c.id===escolhida)?escolhida:'';
  }
  async function salvar(e){
    e.preventDefault();
    if(!empresaAtual)return;
    const empresa=empresaAtual,form=e.currentTarget,botao=form.querySelector('button.primary');
    if(page==='admin'&&!await verifyAdmin(`Salvar os dados de ${$('#dados-empresa-seletor').selectedOptions[0]?.textContent||'empresa'}`))return;
    botao.disabled=true;
    try{
      const {dados}=await api('/api/staff/dados-empresa','PUT',{
        companyId:empresa,confirmed:true,horario:form.elements.horario.value,endereco:form.elements.endereco.value,
        servicos:lerLista('#dados-servicos'),perguntas:lerLista('#dados-perguntas')
      });
      if(empresa===empresaAtual)preencher(dados);
      feedback('#dados-empresa-feedback','Dados salvos.',true);
    }catch(err){feedback('#dados-empresa-feedback',err.message);}
    finally{botao.disabled=false;}
  }
  window.initDadosEmpresa=async()=>{
    // O admin não tem empresa própria: edita pela Administração, onde escolhe a empresa.
    if(page==='atendimento'&&session.user.role==='admin'){
      show($('#dados-empresa-form'),false);
      feedback('#dados-empresa-feedback','Para editar os dados de uma empresa, use a Administração.');
      return;
    }
    montarListas();
    $('#dados-empresa-form').addEventListener('submit',salvar);
    try{
      if(page==='admin'){
        $('#dados-empresa-seletor').addEventListener('change',e=>{feedback('#dados-empresa-feedback','');carregar(e.target.value);});
        await carregarEmpresas();
      }else await carregar();
      pronto=true;
    }catch(err){feedback('#dados-empresa-feedback',err.message);}
  };
  // Empresa recém-cadastrada aparece ao abrir a tela, sem recarregar a página nem perder o que foi digitado.
  window.atualizarEmpresasDosDados=()=>{
    if(pronto&&page==='admin')carregarEmpresas().catch(err=>feedback('#dados-empresa-feedback',err.message));
  };
})();
