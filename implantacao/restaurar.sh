#!/usr/bin/env bash
# Atende.IA — restaura um backup. APAGA o banco atual e coloca o backup no lugar.
# Uso: sudo bash restaurar.sh /var/backups/atende/atende-AAAAMMDD-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")"
ARQUIVO=${1:?informe o arquivo .dump}
[ -f "$ARQUIVO" ] || { echo "Arquivo não encontrado: $ARQUIVO"; exit 1; }
read -r -p "Isto substitui TODOS os dados atuais pelo backup. Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
docker compose stop app
docker compose exec -T postgres pg_restore -U postgres -d atende --clean --if-exists --no-owner --role=postgres < "$ARQUIVO"
docker compose start app
echo "Restauração concluída. Confira o painel."
