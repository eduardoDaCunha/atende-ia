#!/usr/bin/env bash
# Atende.IA — backup diário do banco + limpeza de retenção.
# Agendado pelo cron (veja PASSO-A-PASSO.md, etapa 8). Rodar manualmente: sudo bash backup.sh
#
# 1. pg_dump comprimido em /var/backups/atende (só root lê), guardando os últimos 14 dias.
# 2. Se RCLONE_DESTINO estiver definido no .env (ex.: r2:atende-backups), copia também para FORA
#    da VM. Um backup que só existe na mesma máquina se perde junto com ela.
# 3. Poda fora da VM: apaga cópias do banco e logs com mais de 90 dias. Só roda se a cópia externa
#    DESTA execução deu certo, e nunca deixa menos de 7 cópias do banco no destino.
#    Teste sem apagar nada: ATENDE_PODA_TESTE=1 sudo -E bash backup.sh
# 4. Roda a retenção (dados/manutencao.js) pelo serviço ferramentas.
set -euo pipefail
cd "$(dirname "$0")"
agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "$(agora) Início do backup"
DESTINO=/var/backups/atende
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"
ARQUIVO="$DESTINO/atende-$(date -u +%Y%m%d-%H%M%S).dump"

docker compose exec -T postgres pg_dump -U postgres -d atende --format=custom --compress=9 > "$ARQUIVO.parcial"
mv "$ARQUIVO.parcial" "$ARQUIVO" && chmod 600 "$ARQUIVO"
# Confere se o arquivo é um backup legível antes de apagar os antigos.
docker compose exec -T postgres pg_restore --list < "$ARQUIVO" > /dev/null
find "$DESTINO" -name 'atende-*.dump' -mtime +14 -delete
echo "Backup ok: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"

ler_env() { grep -E "^$1=" .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r' || true; }

RETENCAO=90d          # idade mínima para apagar fora da VM
MINIMO_BANCO=7        # nunca deixar menos que isto de cópias do banco no destino

# Conta as linhas de uma listagem (vazia = 0).
contar() { if [ -z "$1" ]; then echo 0; else printf '%s\n' "$1" | wc -l | tr -d ' '; fi; }

# Poda com filtros estreitos: só nomes com o padrão esperado, nunca a raiz inteira.
# Registra só números (nenhum nome de arquivo). Retorna 1 se algo falhou.
podar() {
  local destino=$1 remoto logs seco="" verbo="removido(s)" total velhos lista rc falhou=0 msg_banco msg_logs
  remoto=${destino%%:*}
  logs=$(ler_env RCLONE_LOGS); [ -n "$logs" ] || logs="$remoto:logs"
  if [ "${ATENDE_PODA_TESTE:-}" = 1 ]; then seco="--dry-run"; verbo="seriam removido(s) (teste, nada apagado)"; fi

  # Banco: só atende-*.dump direto na pasta do RCLONE_DESTINO (max-depth 1: nunca desce para logs/).
  if ! lista=$(rclone lsf --files-only --max-depth 1 --include 'atende-*.dump' "$destino" 2>/dev/null); then
    msg_banco="banco: falha ao listar"; falhou=1
  else
    total=$(contar "$lista")
    if ! lista=$(rclone lsf --files-only --max-depth 1 --min-age "$RETENCAO" --include 'atende-*.dump' "$destino" 2>/dev/null); then
      msg_banco="banco: falha ao listar"; falhou=1
    else
      velhos=$(contar "$lista")
      if [ "$total" -le "$MINIMO_BANCO" ]; then
        msg_banco="banco não podado (só $total cópia(s) no destino; mínimo para podar: mais de $MINIMO_BANCO)"
      elif [ $(( total - velhos )) -lt "$MINIMO_BANCO" ]; then
        msg_banco="banco não podado (restariam $(( total - velhos )) cópia(s), menos de $MINIMO_BANCO)"
      elif [ "$velhos" -eq 0 ]; then
        msg_banco="0 cópia(s) de banco $verbo"
      elif rclone delete $seco --max-depth 1 --min-age "$RETENCAO" --include 'atende-*.dump' "$destino" >/dev/null 2>&1; then
        msg_banco="$velhos cópia(s) de banco $verbo"
      else
        msg_banco="banco: falha ao apagar"; falhou=1
      fi
    fi
  fi

  # Logs: só AAAA-MM-DD/HH.log.gz dentro da pasta de logs. Pasta ainda inexistente (código 3) = 0 logs.
  lista=$(rclone lsf --files-only -R --min-age "$RETENCAO" --include '/????-??-??/??.log.gz' "$logs" 2>/dev/null); rc=$?
  if [ "$rc" -eq 3 ]; then
    msg_logs="0 log(s) $verbo"
  elif [ "$rc" -ne 0 ]; then
    msg_logs="logs: falha ao listar"; falhou=1
  else
    velhos=$(contar "$lista")
    if [ "$velhos" -eq 0 ]; then
      msg_logs="0 log(s) $verbo"
    elif rclone delete $seco --min-age "$RETENCAO" --include '/????-??-??/??.log.gz' "$logs" >/dev/null 2>&1; then
      msg_logs="$velhos log(s) $verbo"
    else
      msg_logs="logs: falha ao apagar"; falhou=1
    fi
  fi

  if [ "$falhou" = 1 ]; then
    echo "$(agora) AVISO: poda fora da VM incompleta: $msg_banco; $msg_logs."
    return 1
  fi
  echo "$(agora) Poda (mais de 90 dias): $msg_banco; $msg_logs."
}

RCLONE_DESTINO=$(ler_env RCLONE_DESTINO)
COPIA_OK=0
if [ -n "$RCLONE_DESTINO" ] && command -v rclone > /dev/null; then
  if rclone copy "$ARQUIVO" "$RCLONE_DESTINO"; then
    COPIA_OK=1
    echo "Cópia externa ok: $RCLONE_DESTINO"
  else
    echo "$(agora) AVISO: a cópia externa falhou; poda fora da VM não executada."
  fi
else
  echo "AVISO: sem cópia externa (defina RCLONE_DESTINO no .env e instale o rclone)."
fi

if [ "$COPIA_OK" = 1 ]; then
  if ! [[ "$RCLONE_DESTINO" =~ ^[A-Za-z0-9_-]+: ]]; then
    echo "$(agora) AVISO: RCLONE_DESTINO fora do formato remoto:pasta; poda não executada."
  else
    # Falha na poda vira AVISO e não interrompe o backup: a manutenção abaixo roda do mesmo jeito.
    podar "$RCLONE_DESTINO" || true
  fi
fi

# Manutenção precisa do dono do banco: roda no serviço ferramentas (o app não tem essa senha).
docker compose run --rm -T ferramentas node dados/manutencao.js
