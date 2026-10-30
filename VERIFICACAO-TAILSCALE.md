# Atende.IA v0.3.8.2 — Teste privado pelo Tailscale

Esta versão corrige o erro `{"error":"Endereço de acesso não permitido."}` no iPhone e evita que o Safari ofereça baixar o JSON de erro ao abrir uma página.

## Instalação sem perder usuários

1. Feche o servidor da versão anterior (`Ctrl+C`).
2. Extraia este ZIP em uma nova pasta.
3. Faça backup da pasta `data` da versão anterior com o servidor desligado. Se quiser manter as contas existentes, copie `data` para o diretório desta versão, ao lado de `server.js`.
4. Execute **INICIAR-ATENDE.bat**. O inicializador configura `PORT=3011` e lê o hostname privado de `config-local.bat` (copie `config-local.exemplo.bat`).
5. No PowerShell, confira `tailscale serve status`. A saída deve indicar `proxy http://127.0.0.1:3011`.
6. No celular conectado à mesma tailnet, abra:
   - Site: `https://SEU-COMPUTADOR.SUA-TAILNET.ts.net/`
   - Login: `https://SEU-COMPUTADOR.SUA-TAILNET.ts.net/acesso`
7. Verifique também o acesso local pelo computador: `http://127.0.0.1:3011/`.

## Testes automatizados

No terminal do VS Code, dentro da pasta do projeto:

```powershell
node tests/tailscale.js
node tests/smoke.js
node scripts/verificar-imagens.js
node scripts/validar-padrao.js
```

Todos esses testes usam dados locais de teste e não exigem credenciais reais. Para rodar o diagnóstico de página, com o servidor aberto em outra janela:

```powershell
node scripts/testar-site.js
```

## Restrições importantes

- **Não use Tailscale Funnel:** ele exporia a aplicação na internet pública.
- O endereço de Serve fica restrito à tailnet, mas todos os participantes autorizados na sua tailnet podem acessar o site público de teste. **Login e permissões continuam obrigatórios nas rotas internas.**
- O protótipo **não está aprovado para produção** e não deve receber dados de clientes reais.
- Não compartilhe sua pasta `data` nem senhas provisórias.
- Se o nome privado da sua tailnet mudar, atualize `TAILSCALE_HOST` no arquivo `.bat` (apenas o hostname, sem `https://`).
- O certificado do Tailscale é usado no endereço privado, mas isso **não substitui** o domínio próprio e o HTTPS necessários para o lançamento comercial.
