// Só para testes: Telegram falso, carregado com --import no servidor de teste (tests/chamados.js).
// Não é uma suíte. Com TESTE_TELEGRAM_REGISTRO definido, cada envio para api.telegram.org é gravado
// nesse arquivo (uma linha JSON por envio: caminho e corpo) e nada sai para a rede.
// Com TESTE_TELEGRAM_FALHA=1, a conexão "cai" (erro de rede) depois de registrar o pedido.
// Os demais endereços seguem para o https.request original.
import https from 'node:https';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const registro = process.env.TESTE_TELEGRAM_REGISTRO;
if (registro) {
  const original = https.request;
  https.request = (...args) => {
    const [opcoes, aoResponder] = args;
    if (!opcoes || typeof opcoes !== 'object' || opcoes.host !== 'api.telegram.org') return original.apply(https, args);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = erro => { setImmediate(() => req.emit('error', erro || new Error('destruída'))); return req; };
    req.end = corpo => {
      fs.appendFileSync(registro, JSON.stringify({ metodo: opcoes.method, caminho: opcoes.path, corpo: String(corpo || '') }) + '\n');
      if (process.env.TESTE_TELEGRAM_FALHA === '1') return req.destroy(new Error('ECONNRESET simulado'));
      setImmediate(() => { const res = new PassThrough(); res.statusCode = 200; aoResponder(res); res.end('{"ok":true}'); });
      return req;
    };
    return req;
  };
}
