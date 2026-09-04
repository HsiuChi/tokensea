#!/usr/bin/env bash
# Migrate Codex credentials from the old codex-dario env format to the
# dario v6 file format (~/.dario/codex-accounts/<alias>.json).
#
# This is a one-time reference helper. The tokensea dario entrypoint already
# generates the file from CODEX_DARIO_OAUTH_* env vars on each boot, so
# normal operation does NOT require running this script. Use it only when
# migrating a pre-existing codex-dario deployment's stored credentials.
#
# Input:  env vars CODEX_DARIO_OAUTH_ACCESS_TOKEN / REFRESH_TOKEN / EXPIRES_AT / ACCOUNT_ID
# Output: ~/.dario/codex-accounts/<ACCOUNT_ID>.json (or DARIO_DIR override)
set -euo pipefail

DARIO_HOME="${DARIO_DIR:-$HOME/.dario}"
CODEX_DIR="$DARIO_HOME/codex-accounts"
ALIAS="${CODEX_DARIO_ACCOUNT_ID:-codex-seat-1}"
EXPIRES="${CODEX_DARIO_OAUTH_EXPIRES_AT:-0}"
case "$EXPIRES" in ''|*[!0-9]*) EXPIRES="0" ;; esac

if [ -z "${CODEX_DARIO_OAUTH_ACCESS_TOKEN:-}" ]; then
  echo "usage: set CODEX_DARIO_OAUTH_ACCESS_TOKEN/REFRESH_TOKEN/EXPIRES_AT/ACCOUNT_ID env, then run" >&2
  exit 1
fi

mkdir -p "$CODEX_DIR"
OUT="$CODEX_DIR/${ALIAS}.json"
cat > "$OUT" <<EOF
{
  "alias": "$ALIAS",
  "accessToken": "$CODEX_DARIO_OAUTH_ACCESS_TOKEN",
  "refreshToken": "${CODEX_DARIO_OAUTH_REFRESH_TOKEN:-}",
  "expiresAt": $EXPIRES
}
EOF
echo "[migrate-codex-creds] wrote $OUT"
jq . "$OUT" 2>/dev/null || cat "$OUT"
