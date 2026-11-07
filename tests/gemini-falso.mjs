// Só para testes: Gemini falso, carregado com --import no servidor de teste (tests/dados-empresa-ia.js).
// Não é uma suíte. Com TESTE_GEMINI_REGISTRO definido, cada pedido ao Gemini é gravado nesse arquivo
// (uma linha JSON por pedido, pasta temporária do teste) e recebe uma resposta fictícia; nada sai para a rede.
// Os demais endereços (ex.: Graph API falsa do teste) seguem para o fetch original.
import fs from 'node:fs';

const registro = process.env.TESTE_GEMINI_REGISTRO;
if (registro) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opcoes = {}) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, opcoes);
    fs.appendFileSync(registro, String(opcoes.body || '') + '\n');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Resposta fictícia do Gemini falso.' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
