#!/usr/bin/env bash
# Script de pull + restart para el VPS aichat.xpandex.es (5.180.173.8).
# Se copia/instala en /www/wwwroot/AiChat/scripts/vps-deploy-pull.sh.
# Se ejecuta como root vía SSH desde el flujo de deploy local.
#
# Flujo:
#   1. cd /www/wwwroot/AiChat
#   2. git fetch + git reset --hard origin/deploy (la rama deploy es runtime)
#   3. Si package.json cambió → npm install --omit=dev
#   4. Mata el proceso Node anterior (PID file de aaPanel) y borra resumer.lock
#   5. Relanza el startup script de aaPanel como usuario www

set -euo pipefail

APP_DIR="/www/wwwroot/AiChat"
DEPLOY_BRANCH="deploy"
PID_FILE="/www/server/nodejs/vhost/pids/AiChat.pid"
STARTUP_SCRIPT="/www/server/nodejs/vhost/scripts/AiChat.sh"
LOCK_FILE="$APP_DIR/.baileys_auth_data/resumer.lock"

echo "==> [vps-deploy-pull] $(date -u +%FT%TZ)"

cd "$APP_DIR"

echo "==> git fetch + reset a origin/$DEPLOY_BRANCH"
PRE_HASH_PKG=$(sha256sum package.json 2>/dev/null | awk '{print $1}' || echo "")
git fetch origin "$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"
POST_HASH_PKG=$(sha256sum package.json 2>/dev/null | awk '{print $1}' || echo "")

if [ "$PRE_HASH_PKG" != "$POST_HASH_PKG" ]; then
  echo "==> package.json cambió → npm install --omit=dev"
  /www/server/nodejs/v24.15.0/bin/npm install --omit=dev --no-audit --no-fund
else
  echo "==> package.json sin cambios, omito npm install"
fi

echo "==> Matando proceso anterior"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
fi
pkill -f "node .*$APP_DIR" 2>/dev/null || true
sleep 1

echo "==> Limpiando resumer.lock si quedó huérfano"
rm -f "$LOCK_FILE"

echo "==> Relanzando via aaPanel startup script"
if [ -x "$STARTUP_SCRIPT" ]; then
  # aaPanel ejecuta los Node como usuario "www"
  su -s /bin/bash www -c "$STARTUP_SCRIPT" || "$STARTUP_SCRIPT"
else
  echo "!! Startup script no encontrado en $STARTUP_SCRIPT" >&2
  exit 1
fi

sleep 2
NEW_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
echo "==> Listo. PID nuevo: ${NEW_PID:-(no escrito todavía)}"
echo "==> Tail del log:"
tail -n 20 "$APP_DIR/logs/app.log" 2>/dev/null || tail -n 20 /www/server/nodejs/vhost/logs/AiChat.log 2>/dev/null || echo "(sin log accesible)"
