/* Atende.IA | reconhece cidades brasileiras mesmo com erros de digitação e devolve a UF.
   Dados: municipios.json (IBGE). Funciona no navegador (window.AtendeCidades) e no Node (testes). */
'use strict';
(function(raiz){
  // Apelidos comuns que a distância de letras não alcança.
  const APELIDOS={floripa:['Florianópolis','SC'],sampa:['São Paulo','SP'],bh:['Belo Horizonte','MG'],beaga:['Belo Horizonte','MG'],
    poa:['Porto Alegre','RS'],sjc:['São José dos Campos','SP'],sjrp:['São José do Rio Preto','SP'],rj:['Rio de Janeiro','RJ']};

  /** Chave de comparação: sem acentos, minúsculas, só letras e números; "sta"/"sto" viram "santa"/"santo". */
  function chave(texto){
    return String(texto||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
      .replace(/\bsta\b\.?/g,'santa').replace(/\bsto\b\.?/g,'santo').replace(/[^a-z0-9]/g,'');
  }
  /** Distância de edição com transposição (Damerau, versão "alinhamento ótimo"), com corte para ficar rápida. */
  function distancia(a,b,limite){
    if(Math.abs(a.length-b.length)>limite)return limite+1;
    let ante=null,prev=Array.from({length:b.length+1},(_,j)=>j);
    for(let i=1;i<=a.length;i++){
      const atual=[i];let menor=i;
      for(let j=1;j<=b.length;j++){
        const custo=a[i-1]===b[j-1]?0:1;
        let v=Math.min(prev[j]+1,atual[j-1]+1,prev[j-1]+custo);
        if(ante&&i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])v=Math.min(v,ante[j-2]+1);
        atual.push(v);if(v<menor)menor=v;
      }
      if(menor>limite)return limite+1;
      ante=prev;prev=atual;
    }
    return prev[b.length];
  }
  /** Erros aceitos conforme o tamanho: nomes curtos precisam ser quase exatos. */
  const tolerancia=n=>n<4?0:n<8?1:n<12?2:3;

  function criar(dados){
    const cidades=[];
    for(const [uf,nomes] of Object.entries(dados.ufs||{}))for(const nome of nomes)cidades.push({nome,uf,k:chave(nome)});
    const ufs=new Set(Object.keys(dados.ufs||{}));

    /** Separa uma UF digitada no fim ("Florianópolis - SC", "florianopolis/sc"). */
    function separarUf(texto){
      const m=String(texto||'').trim().match(/^(.*?)[\s,\-\/]+([A-Za-z]{2})$/);
      if(m&&ufs.has(m[2].toUpperCase())&&chave(m[1]).length>=3)return {resto:m[1],uf:m[2].toUpperCase()};
      return {resto:texto,uf:null};
    }
    /** Sugestões para a lista (até `limite`), melhores primeiro. distancia 0 = nome exato. */
    function buscar(texto,limite=6){
      const {resto,uf}=separarUf(texto),q=chave(resto);
      if(q.length<2)return [];
      const apelido=APELIDOS[q];
      if(apelido&&!uf)return [{nome:apelido[0],uf:apelido[1],distancia:0,tipo:'apelido'}];
      const tol=tolerancia(q.length),achados=[];
      for(const c of cidades){
        if(uf&&c.uf!==uf)continue;
        if(c.k===q){achados.push({c,nota:0,d:0,tipo:'exato'});continue;}
        if(q.length>=3&&c.k.startsWith(q)){achados.push({c,nota:0.5+(c.k.length-q.length)/100,d:null,tipo:'comeco'});continue;}
        if(tol){const d=distancia(q,c.k,tol);if(d<=tol)achados.push({c,nota:d,d,tipo:'parecido'});}
      }
      achados.sort((a,b)=>a.nota-b.nota||a.c.nome.localeCompare(b.c.nome,'pt-BR')||a.c.uf.localeCompare(b.c.uf));
      return achados.slice(0,limite).map(x=>({nome:x.c.nome,uf:x.c.uf,distancia:x.d,tipo:x.tipo}));
    }
    /**
     * Decide a cidade de um texto já digitado:
     *  {tipo:'unica', cidade:{nome,uf}} | {tipo:'ambigua', opcoes:[...]} | {tipo:'nenhuma'}.
     * Texto que é começo de nomes reais conta como "ainda digitando": só vira cidade se sobrar uma única
     * opção (com 5+ letras); senão fica nas sugestões, sem tentar adivinhar por semelhança.
     */
    function reconhecer(texto){
      const todos=buscar(texto,50);
      const exatos=todos.filter(x=>x.distancia===0);
      if(!exatos.length){
        const comecos=todos.filter(x=>x.tipo==='comeco');
        if(comecos.length===1&&chave(separarUf(texto).resto).length>=5)return {tipo:'unica',cidade:{nome:comecos[0].nome,uf:comecos[0].uf},corrigido:true};
        if(comecos.length)return {tipo:'nenhuma'};
      }
      const candidatos=todos.filter(x=>x.tipo!=='comeco');
      if(!candidatos.length)return {tipo:'nenhuma'};
      const melhor=candidatos[0].distancia;
      const empatados=candidatos.filter(x=>x.distancia===melhor);
      if(empatados.length===1)return {tipo:'unica',cidade:{nome:empatados[0].nome,uf:empatados[0].uf},corrigido:melhor>0};
      return {tipo:'ambigua',opcoes:empatados.slice(0,8).map(x=>({nome:x.nome,uf:x.uf}))};
    }
    return {buscar,reconhecer,total:cidades.length};
  }

  const api={criar,chave,distancia};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else raiz.AtendeCidades=api;
})(typeof window!=='undefined'?window:globalThis);
