#!/bin/sh

VAULT="/app/stealth-watcher/vault.enc"
PASSPHRASE="/app/stealth-watcher/passphrase.txt"
RETRY_DELAY=15

# Always start frontend in background
FRONTEND_PORT="${FRONTEND_PORT:-8766}"
echo "[entrypoint] Starting frontend on :${FRONTEND_PORT}..."
cd /app && node_modules/.bin/next start -p "$FRONTEND_PORT" &

# Start watcher in a retry loop if vault and passphrase exist
if [ -f "$VAULT" ] && [ -f "$PASSPHRASE" ]; then
  (
    while true; do
      WATCHER_PORT="${WATCHER_PORT:-8765}"
      echo "[entrypoint] Starting watcher on :${WATCHER_PORT}..."
      cd /app/stealth-watcher && npm run start || true
      echo "[entrypoint] Watcher stopped or crashed — retrying in ${RETRY_DELAY}s..."
      sleep $RETRY_DELAY
    done
  ) &
else
  echo "[entrypoint] No vault found — watcher not started. Frontend only mode."
fi

wait
