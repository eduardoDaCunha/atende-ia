// Só para testes: relógio adiantável, carregado com --import no servidor de teste (tests/bloqueio-login.js).
// Não é uma suíte. Com TESTE_RELOGIO definido (arquivo na pasta temporária do teste), Date.now() passa a
// devolver a hora real somada ao deslocamento em milissegundos gravado nesse arquivo, relido a cada 50 ms.
// O teste grava, por exemplo, 61000 para "andar" 61 s sem esperar. O código de produção não muda.
import fs from 'node:fs';

const arquivo = process.env.TESTE_RELOGIO;
if (arquivo) {
  const real = Date.now.bind(Date);
  let deslocamento = 0;
  const ler = () => { try { deslocamento = Number(fs.readFileSync(arquivo, 'utf8')) || 0; } catch {} };
  ler();
  setInterval(ler, 50).unref();
  Date.now = () => real() + deslocamento;
}
