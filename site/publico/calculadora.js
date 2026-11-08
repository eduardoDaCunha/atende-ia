'use strict';
/* Calculadora de perda de vendas. Roda só no navegador: não envia nem guarda o que é digitado.
   As funções de cálculo não usam a tela, para o teste poder chamá-las pelo Node. */
(() => {
  const CAMPOS = {
    contatos: { max: 100_000_000, inteiro: true, erroLimite: 'Use no máximo 100.000.000 contatos.' },
    semResposta: { max: 100, erroLimite: 'O percentual vai de 0 a 100.' },
    conversao: { max: 100, erroLimite: 'O percentual vai de 0 a 100.' },
    valorVenda: { max: 1_000_000_000, erroLimite: 'Use um valor de até R$ 1.000.000.000.' }
  };

  // Devolve null para campo vazio e NaN para texto que não é número no formato brasileiro.
  function lerNumero(texto) {
    const limpo = String(texto ?? '').replace(/R\$|%|\s/g, '');
    if (!limpo) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpo)) return Number(limpo.replace(/\./g, '').replace(',', '.'));
    if (/^\d+(,\d+)?$/.test(limpo)) return Number(limpo.replace(',', '.'));
    if (/^\d+\.\d{1,2}$/.test(limpo)) return Number(limpo);
    return NaN;
  }

  // Devolve { valor, erro }. Campo vazio não é erro: apenas ainda não foi preenchido.
  function validarCampo(nome, texto) {
    const campo = CAMPOS[nome];
    const valor = lerNumero(texto);
    if (valor === null) return { valor: null, erro: '' };
    if (Number.isNaN(valor)) return { valor: null, erro: 'Digite só números, por exemplo 1.500,50.' };
    if (campo.inteiro && !Number.isInteger(valor)) return { valor: null, erro: 'Digite um número inteiro.' };
    if (valor > campo.max) return { valor: null, erro: campo.erroLimite };
    return { valor, erro: '' };
  }

  function calcularPerda({ contatos, semResposta, conversao, valorVenda }) {
    const contatosPerdidos = contatos * semResposta / 100;
    const vendasPerdidas = contatosPerdidos * conversao / 100;
    const perdaMes = vendasPerdidas * valorVenda;
    return { contatosPerdidos, vendasPerdidas, perdaMes, perdaAno: perdaMes * 12 };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { lerNumero, validarCampo, calcularPerda };
    return;
  }

  const quantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const AVISO_INICIAL = 'Preencha os quatro campos para ver a estimativa.';

  function iniciar() {
    const form = document.getElementById('calc-form');
    const situacao = document.getElementById('calc-situacao');
    const anuncio = document.getElementById('calc-anuncio');
    const saidas = {
      contatos: document.getElementById('r-contatos'),
      vendas: document.getElementById('r-vendas'),
      mes: document.getElementById('r-mes'),
      ano: document.getElementById('r-ano')
    };
    let esperaAnuncio;

    function mostrarErro(nome, erro) {
      const entrada = form.elements[nome];
      const caixa = document.getElementById(`${nome}-erro`);
      caixa.textContent = erro;
      caixa.hidden = !erro;
      if (erro) entrada.setAttribute('aria-invalid', 'true');
      else entrada.removeAttribute('aria-invalid');
    }

    function escreverResultado(textos) {
      saidas.contatos.textContent = textos.contatos;
      saidas.vendas.textContent = textos.vendas;
      saidas.mes.textContent = textos.mes;
      saidas.ano.textContent = textos.ano;
    }

    function atualizar() {
      const valores = {};
      let temErro = false;
      for (const nome of Object.keys(CAMPOS)) {
        const { valor, erro } = validarCampo(nome, form.elements[nome].value);
        mostrarErro(nome, erro);
        valores[nome] = valor;
        if (erro) temErro = true;
      }
      const completo = Object.values(valores).every(valor => valor !== null);
      clearTimeout(esperaAnuncio);

      if (temErro || !completo) {
        escreverResultado({ contatos: '—', vendas: '—', mes: '—', ano: '—' });
        situacao.textContent = temErro ? 'Corrija o campo indicado para ver a estimativa.' : AVISO_INICIAL;
        situacao.hidden = false;
        anuncio.textContent = '';
        return;
      }

      const r = calcularPerda(valores);
      const textos = {
        contatos: quantidade.format(r.contatosPerdidos),
        vendas: quantidade.format(r.vendasPerdidas),
        mes: dinheiro.format(r.perdaMes),
        ano: dinheiro.format(r.perdaAno)
      };
      escreverResultado(textos);
      situacao.hidden = true;
      // Espera a pessoa parar de digitar para o leitor de tela não anunciar cada tecla.
      esperaAnuncio = setTimeout(() => {
        anuncio.textContent = `Estimativa: perda de ${textos.mes} por mês e ${textos.ano} por ano.`;
      }, 800);
    }

    form.addEventListener('input', atualizar);
    form.addEventListener('submit', evento => evento.preventDefault());
    // O evento reset dispara antes de os campos serem limpos.
    form.addEventListener('reset', () => setTimeout(atualizar, 0));
    atualizar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
