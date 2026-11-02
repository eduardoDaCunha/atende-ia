'use strict';
// Agente do site: responde sobre automação e sistemas, sem inventar preço e sem textos internos.
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
process.env.ATENDE_DATA_DIR=path.join(os.tmpdir(),'atende-agente-site');
const {siteAnswer}=require('../resposta');

const casos=[
  ['Como funciona?',/quatro passos/],
  ['O que é a Atende.IA?',/quatro passos/],
  ['O que vocês automatizam?',/Automatizamos/],
  ['Dá para automatizar meu processo manual?',/Automatizamos/],
  ['Serve para minha empresa?',/ramo/],
  ['Serve para uma clínica odontológica?',/recepção/],
  ['Tenho uma imobiliária, como aplicar?',/corretor/],
  ['Sou dono de um restaurante',/cardápio/],
  ['Quanto custa?',/definido por projeto/],
  ['Qual o valor da mensalidade para minha loja?',/definido por projeto/],
  ['Quanto tempo demora para implantar?',/prazo depende/],
  ['Funciona no WhatsApp?',/API oficial/],
  ['Integra com o meu ERP?',/Integrações são definidas/],
  ['Vocês criam sistema sob medida?',/Desenvolvemos sistemas/],
  ['Fazem aplicativo?',/Desenvolvemos sistemas/],
  ['Posso falar com um atendente?',/atendente assume/],
  ['O robô pode inventar coisas?',/não inventar/],
  ['Meus dados ficam seguros?',/controlado no servidor/],
  ['Vai substituir meus funcionários?',/equipe continua/],
  ['Funciona de madrugada?',/fora do horário/],
  ['Você é um robô?',/agente virtual/],
  ['Oi',/Pergunte como funciona/],
  ['Obrigado',/Por nada/],
  ['Qual a capital da França?',/Posso explicar/]
];
for(const [pergunta,esperado] of casos) assert.match(siteAnswer(pergunta),esperado,pergunta);

const proibido=/fict[ií]ci|demonstra[cç]|prot[oó]tipo|simula|em desenvolvimento|de teste|—|R\$/i;
for(const [pergunta] of casos) assert.equal(proibido.test(siteAnswer(pergunta)),false,`Texto interno ou preço: ${pergunta}`);
console.log('OK: agente do site responde sobre funcionamento, automação, aplicação por ramo, integrações e sistemas, sem preço nem texto interno.');
