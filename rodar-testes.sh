#!/usr/bin/env bash
# Roda todas as suítes. Uso:
#   bash rodar-testes.sh             -> motor JSON (padrão)
#   TESTE_PG_DONO=postgres://dono:senha@127.0.0.1:5432/postgres TESTE_PG_APP_SENHA=... bash rodar-testes.sh --postgres
#                                    -> as mesmas suítes com o servidor no PostgreSQL (um banco por teste)
cd "$(dirname "$0")"
suites="smoke tailscale dados-permanentes atualizacoes-seguras whatsapp whatsapp-painel cidades agente-site diagnostico ferramentas mcp negocio protecao-requisicoes alertas-seguranca config-empresa proxy-confiavel mfa calculadora dados-empresa chat-demo login-tempo limites whatsapp-limites bloqueio-login contatos-protecao postgres"
if [ "$1" = "--postgres" ]; then
  [ -n "$TESTE_PG_DONO" ] && [ -n "$TESTE_PG_APP_SENHA" ] || { echo "Defina TESTE_PG_DONO e TESTE_PG_APP_SENHA."; exit 2; }
  export NODE_OPTIONS="--import=file://$PWD/tests/preparar-pg.mjs"
  # Estas testam a troca de versão sobre os arquivos JSON; não se aplicam ao banco.
  suites=$(echo " $suites " | sed 's/ dados-permanentes / /; s/ atualizacoes-seguras / /')
fi
falhas=0
for t in $suites; do
  if out=$(timeout 120 node "tests/$t.js" 2>&1) && echo "$out" | grep -qE '^(OK|PULADO)'; then echo "ok    $t$(echo "$out" | grep -q '^PULADO' && echo ' (pulado)')"; else echo "FALHA $t"; echo "$out" | tail -5; falhas=$((falhas+1)); fi
done
if [ "$1" = "--postgres" ]; then
  # Remove os bancos temporários criados pelos testes.
  node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.TESTE_PG_DONO});await c.connect();for(const r of (await c.query(\"SELECT datname FROM pg_database WHERE starts_with(datname, 'atende_t_')\")).rows)await c.query('DROP DATABASE '+r.datname+' WITH (FORCE)');await c.end();})()" 2>/dev/null
fi
echo "falhas: $falhas"; exit $falhas
