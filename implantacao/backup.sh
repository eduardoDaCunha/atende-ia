#!/usr/bin/env bash
# Atende.IA — backup diário do banco + limpeza de retenção.
# Agendado pelo cron (veja PASSO-A-PASSO.md, etapa 8). Rodar manualmente: sudo bash backup.sh
#
# 1. pg_dump comprimido em /var/backups/atende (só root lê), guardando os últimos 14 dias.
# 2. Se RCLONE_DESTINO estiver definido no .env (ex.: r2:atende-backups), copia também para FORA
#    da VM. Um backup que só existe na mesma máquina se perde junto com ela.
# 3. Roda a retenção (dados/manutencao.js) pelo serviço ferramentas.
set -euo pipefail
cd "$(dirname "$0")"
DESTINO=/var/backups/atende
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"
ARQUIVO="$DESTINO/atende-$(date -u +%Y%m%d-%H%M%S).dump"

docker compose exec -T postgres pg_dump -U postgres -d atende --format=custom --compress=9 > "$ARQUIVO.parcial"
mv "$ARQUIVO.parcial" "$ARQUIVO" && chmod 600 "$ARQUIVO"
# Confere se o arquivo é um backup legível antes de apagar os antigos.
docker compose exec -T postgres pg_restore --list < "$ARQUIVO" > /dev/null
find "$DESTINO" -name 'atende-*.dump' -mtime +14 -delete
echo "Backup ok: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"

RCLONE_DESTINO=$(grep -E '^RCLONE_DESTINO=' .env 2>/dev/null | cut -d= -f2- || true)
if [ -n "$RCLONE_DESTINO" ] && command -v rclone > /dev/null; then
  rclone copy "$ARQUIVO" "$RCLONE_DESTINO" && echo "Cópia externa ok: $RCLONE_DESTINO"
else
  echo "AVISO: sem cópia externa (defina RCLONE_DESTINO no .env e instale o rclone)."
fi

# Manutenção precisa do dono do banco: roda no serviço ferramentas (o app não tem essa senha).
docker compose run --rm -T ferramentas node dados/manutencao.js
