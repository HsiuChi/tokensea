#!/usr/bin/env bash
# TokenSea dario entrypoint
# Updates CC to latest version before starting, then launches dario.
# This ensures the live fingerprint capture always gets the current CC shape
# (tools, system prompt, headers).

set -e

# Start TLS shim in background if enabled (default: on)
if [ "${DARIO_TLS_SHIM:-1}" = "1" ]; then
  /usr/local/bin/tls-shim &
  SHIM_PID=$!
  SHIM_ADDR="${TLS_SHIM_LISTEN_ADDR:-127.0.0.1:3443}"
  echo "[tokensea] TLS shim started (PID ${SHIM_PID}, listening on ${SHIM_ADDR})"

  # Wait for shim to be ready (health check on listen port)
  SHIM_READY=0
  for i in $(seq 1 20); do
    if curl -sf --max-time 1 "http://${SHIM_ADDR}/healthz" > /dev/null 2>&1; then
      SHIM_READY=1
      break
    fi
    # Also check if the process is still alive
    if ! kill -0 "$SHIM_PID" 2>/dev/null; then
      echo "[tokensea] ERROR: TLS shim process died unexpectedly" >&2
      exit 1
    fi
    sleep 0.25
  done

  if [ "$SHIM_READY" -eq 1 ]; then
    echo "[tokensea] TLS shim ready (${SHIM_ADDR})"
  else
    if [ "${DARIO_TLS_SHIM_FALLBACK:-0}" = "1" ]; then
      echo "[tokensea] WARN: TLS shim not responding after 5s — fallback mode, upstream calls will bypass shim"
    else
      echo "[tokensea] ERROR: TLS shim not responding after 5s — aborting (set DARIO_TLS_SHIM_FALLBACK=1 to continue without shim)" >&2
      exit 1
    fi
  fi
fi

# Update Claude Code to latest version (unless explicitly disabled)
if [ "${DARIO_NO_CC_UPDATE:-0}" != "1" ]; then
  echo "[tokensea] Updating Claude Code to latest version..."
  bun update -g @anthropic-ai/claude-code 2>/dev/null || {
    echo "[tokensea] Warning: CC update failed, using installed version"
  }
fi

# Report installed CC version
CC_VER=""
if command -v claude &>/dev/null; then
  CC_VER=$(claude --version 2>/dev/null | head -1 || echo "unknown")
  echo "[tokensea] Claude Code version: ${CC_VER}"
else
  echo "[tokensea] Warning: claude binary not found on PATH"
fi

# Launch dario
exec bun run dist/cli.js "$@"
