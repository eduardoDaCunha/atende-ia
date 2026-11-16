#!/usr/bin/env bash
# Atende.IA — envia os logs da hora anterior para FORA da VM (remoto rclone com crypt).
# Cron do root, toda hora (veja PASSO-A-PASSO.md, etapa 8):
#   5 * * * * cd /home/ubuntu/atende-ia/implantacao && bash logs-fora.sh >> /var/log/atende-logs-fora.log 2>&1
# Rodar manualmente: sudo bash logs-fora.sh
#
# O que vai, por hora cheia (UTC): docker compose logs do app e do Caddy, as linhas do /var/log/auth.log
# da mesma hora e as linhas novas do /var/log/atende-backup.log. Nada de .env, variáveis de ambiente,
# docker inspect ou dados do banco.
# Destino: <remoto>:logs/AAAA-MM-DD/HH.log.gz, onde <remoto> é o do RCLONE_DESTINO do .env
# (ou RCLONE_LOGS=remoto:pasta no .env, se quiser outro lugar).
# Se o envio falhar, o arquivo fica em /var/lib/atende-logs/pendente e vai na próxima execução;
# se uma execução não rodar (VM desligada), a próxima junta as horas que faltaram (até 48).
#
# Este script NUNCA mostra o conteúdo dos logs: escreve uma única linha por execução (ok ou AVISO),
# sem nomes de arquivos nem valores. A saída do docker e do rclone é descartada.
set -uo pipefail
umask 077
cd "$(dirname "$0")" || exit 1

# Caminhos reais por padrão; as variáveis ATENDE_LOGS_* existem só para teste.
ESTADO=${ATENDE_LOGS_ESTADO:-/var/lib/atende-logs}
AUTH_LOGS=${ATENDE_LOGS_AUTH:-/var/log/auth.log.1 /var/log/auth.log}
BACKUP_LOG=${ATENDE_LOGS_BACKUP:-/var/log/atende-backup.log}
AGORA=${ATENDE_LOGS_AGORA:-$(date -u +%s)}
MAX_HORAS=48
PENDENTE="$ESTADO/pendente"
ULTIMA_ARQ="$ESTADO/ultima-hora"       # início (epoch) da última hora já juntada
POSICAO_ARQ="$ESTADO/posicao-backup"   # bytes do atende-backup.log já juntados

linha() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
aviso() { linha "AVISO: $*"; exit 1; }

# Lê só a linha pedida do .env, sem exibir nada.
ler_env() { grep -E "^$1=" .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r' || true; }

DESTINO_LOGS=$(ler_env RCLONE_LOGS)
if [ -z "$DESTINO_LOGS" ]; then
  RCLONE_DESTINO=$(ler_env RCLONE_DESTINO)
  if [[ "$RCLONE_DESTINO" =~ ^([A-Za-z0-9_-]+): ]]; then
    DESTINO_LOGS="${BASH_REMATCH[1]}:logs"
  fi
fi
[[ "$DESTINO_LOGS" =~ ^[A-Za-z0-9_-]+: ]] || aviso "logs não enviados: sem destino (defina RCLONE_DESTINO no .env)."
DESTINO_LOGS=${DESTINO_LOGS%/}
command -v rclone > /dev/null || aviso "logs não enviados: rclone não instalado."
command -v docker > /dev/null || aviso "logs não enviados: docker não encontrado."

# "remoto:" + "a/b" = "remoto:a/b"; "remoto:pasta" + "a/b" = "remoto:pasta/a/b".
caminho() { case "$DESTINO_LOGS" in *:) echo "$DESTINO_LOGS$1" ;; *) echo "$DESTINO_LOGS/$1" ;; esac; }

mkdir -p "$PENDENTE" && chmod 700 "$ESTADO" "$PENDENTE" || aviso "logs não enviados: não consegui criar a pasta de estado."

# Uma execução por vez (o cron e um teste manual ao mesmo tempo não se atropelam).
if command -v flock > /dev/null; then
  exec 9> "$ESTADO/trava" && flock -n 9 || aviso "logs não enviados: outra execução em andamento."
fi

iso_utc() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

# Janelas: horas cheias desde a última juntada até a hora anterior à atual.
FIM=$(( AGORA / 3600 * 3600 ))
ULTIMA=$(cat "$ULTIMA_ARQ" 2>/dev/null || true)
if [[ "$ULTIMA" =~ ^[0-9]+$ ]]; then INICIO=$(( ULTIMA + 3600 )); else INICIO=$(( FIM - 3600 )); fi
MINIMO=$(( FIM - MAX_HORAS * 3600 ))
[ "$INICIO" -lt "$MINIMO" ] && INICIO=$MINIMO

# Junta uma hora num .log.gz em pendente/. O log do backup entra só na última hora da execução.
coletar() {
  local h=$1 fim=$(( $1 + 3600 )) com_backup=$2 nome bruto ini_local fim_local f tam pos
  nome="$PENDENTE/$(date -u -d "@$h" +%Y-%m-%d_%H).log.gz"
  bruto="$ESTADO/coleta.tmp"
  NOVA_POSICAO=""
  : > "$bruto" || return 1
  {
    echo "=== docker compose logs (app, caddy): $(iso_utc "$h") a $(iso_utc "$fim") ==="
    docker compose logs --no-color --timestamps --since "$(iso_utc "$h")" --until "$(iso_utc "$fim")" app caddy 2> /dev/null
  } >> "$bruto" || { rm -f "$bruto"; return 1; }

  # auth.log do Ubuntu 24.04: cada linha começa com a data local em ISO (2026-11-14T10:03:12...).
  ini_local=$(date -d "@$h" +%Y-%m-%dT%H:%M:%S)
  fim_local=$(date -d "@$fim" +%Y-%m-%dT%H:%M:%S)
  echo "=== auth.log: $(iso_utc "$h") a $(iso_utc "$fim") ===" >> "$bruto"
  for f in $AUTH_LOGS; do
    [ -r "$f" ] || continue
    awk -v a="$ini_local" -v b="$fim_local" '{ t = substr($0, 1, 19) } t >= a && t < b' "$f" >> "$bruto" 2> /dev/null \
      || { rm -f "$bruto"; return 1; }
  done

  if [ "$com_backup" = 1 ] && [ -r "$BACKUP_LOG" ]; then
    tam=$(stat -c %s "$BACKUP_LOG" 2> /dev/null) || { rm -f "$bruto"; return 1; }
    pos=$(cat "$POSICAO_ARQ" 2> /dev/null || true)
    [[ "$pos" =~ ^[0-9]+$ ]] || pos=0
    [ "$tam" -lt "$pos" ] && pos=0     # o arquivo encolheu (rotação): recomeça do início
    echo "=== atende-backup.log: linhas novas ===" >> "$bruto"
    if [ "$tam" -gt "$pos" ]; then
      tail -c +"$(( pos + 1 ))" "$BACKUP_LOG" 2> /dev/null | head -c "$(( tam - pos ))" >> "$bruto" \
        || { rm -f "$bruto"; return 1; }
    fi
    NOVA_POSICAO=$tam
  fi

  gzip -c "$bruto" > "$nome.parcial" 2> /dev/null && mv -f "$nome.parcial" "$nome" \
    || { rm -f "$bruto" "$nome.parcial"; return 1; }
  rm -f "$bruto"
  chmod 600 "$nome"
  # O conteúdo já está guardado em pendente/: avança o estado (assim nada é juntado duas vezes).
  [ -n "$NOVA_POSICAO" ] && echo "$NOVA_POSICAO" > "$POSICAO_ARQ"
  echo "$h" > "$ULTIMA_ARQ"
}

FALHA_COLETA=""
h=$INICIO
while [ "$h" -lt "$FIM" ]; do
  com_backup=0; [ $(( h + 3600 )) -ge "$FIM" ] && com_backup=1
  if ! coletar "$h" "$com_backup"; then FALHA_COLETA=$(date -u -d "@$h" '+%Y-%m-%d %H'); break; fi
  h=$(( h + 3600 ))
done

# Envia tudo o que está pendente, do mais antigo ao mais novo. Na primeira falha, para: o resto fica
# guardado para a próxima execução.
ENVIADOS=0; FALHA_ENVIO=""
for arq in "$PENDENTE"/*.log.gz; do
  [ -e "$arq" ] || continue
  base=$(basename "$arq" .log.gz)
  [[ "$base" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})$ ]] || continue
  if rclone copyto "$arq" "$(caminho "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.log.gz")" > /dev/null 2>&1; then
    rm -f "$arq"; ENVIADOS=$(( ENVIADOS + 1 ))
  else
    FALHA_ENVIO="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"; break
  fi
done
RESTAM=$(find "$PENDENTE" -maxdepth 1 -name '*.log.gz' | wc -l)

if [ -n "$FALHA_ENVIO" ]; then
  aviso "envio dos logs falhou ($FALHA_ENVIO); $RESTAM arquivo(s) mantido(s) para a próxima tentativa."
fi
if [ -n "$FALHA_COLETA" ]; then
  aviso "não consegui juntar os logs ($FALHA_COLETA); tento de novo na próxima execução. $ENVIADOS arquivo(s) enviado(s)."
fi
linha "Logs fora ok: $ENVIADOS arquivo(s) enviado(s)."
