#!/bin/bash
set -euo pipefail

# ── Start the Rust TLS shim ──────────────────────────────────────
SOCKET_PATH="${CODEX_DARIO_TLS_SHIM_SOCKET:-/tmp/codex-dario-tls-shim.sock}"

echo "[codex-dario] Starting TLS shim at ${SOCKET_PATH}"
/app/tls-shim "$SOCKET_PATH" &
SHIM_PID=$!

# Wait for the shim socket to appear
TIMEOUT=10
ELAPSED=0
while [ ! -S "$SOCKET_PATH" ]; do
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))
  if [ $ELAPSED -ge $((TIMEOUT * 2)) ]; then
    echo "[codex-dario] WARNING: TLS shim socket not found after ${TIMEOUT}s"
    break
  fi
done

# Export socket path for the proxy
export CODEX_DARIO_TLS_SHIM_SOCKET="$SOCKET_PATH"

# ── Report Codex CLI version (if installed) ──────────────────────
if command -v codex &> /dev/null; then
  CODEX_VER=$(codex --version 2>/dev/null || echo "unknown")
  echo "[codex-dario] Codex CLI version: ${CODEX_VER}"
else
  echo "[codex-dario] Codex CLI not installed — using bundled template"
  export CODEX_DARIO_NO_LIVE_CAPTURE=1
fi

# ── Start the proxy ──────────────────────────────────────────────
echo "[codex-dario] Starting proxy..."
exec bun run /app/dist/cli.js "$@"

# Clean up shim on exit (handled by trap)
trap "kill $SHIM_PID 2>/dev/null; rm -f $SOCKET_PATH" EXIT
