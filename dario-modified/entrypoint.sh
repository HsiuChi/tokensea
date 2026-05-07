#!/usr/bin/env bash
# TokenSea dario entrypoint
# Updates CC to latest version before starting, then launches dario.
# This ensures the live fingerprint capture always gets the current CC shape
# (tools, system prompt, headers).

set -e

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
