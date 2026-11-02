#!/usr/bin/env bash
# Roda todas as suítes. Uso: bash rodar-testes.sh
cd "$(dirname "$0")"
falhas=0
for t in smoke tailscale dados-permanentes atualizacoes-seguras whatsapp whatsapp-painel cidades agente-site diagnostico ferramentas mcp negocio protecao-requisicoes alertas-seguranca; do
  if out=$(timeout 120 node "tests/$t.js" 2>&1) && echo "$out" | grep -q '^OK'; then echo "ok    $t"; else echo "FALHA $t"; echo "$out" | tail -5; falhas=$((falhas+1)); fi
done
echo "falhas: $falhas"; exit $falhas
