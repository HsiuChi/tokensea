#!/usr/bin/env bash
# Clone/update the tokensea dario fork at a pinned tag.
#
# dario-modified/ is a clone of https://github.com/HsiuChi/dario (fork of
# askalf/dario) with a tokensea overlay (tokensea-Dockerfile + tokensea-entrypoint.sh).
# It is excluded from the tokensea repo via .gitignore and must be cloned
# before `docker compose build dario-1`.
#
# Usage:
#   ./scripts/setup-dario.sh                # clone at pinned tag (default)
#   ./scripts/setup-dario.sh v6.0.19        # clone at a specific tag
#   ./scripts/setup-dario.sh update         # git pull upstream + rebase overlay
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DARIO_DIR="$ROOT/dario-modified"
FORK_URL="https://github.com/Hsiuqi/dario.git"
UPSTREAM_URL="https://github.com/askalf/dario.git"
DEFAULT_TAG="v6.0.17"

cmd="${1:-clone}"
tag="${2:-$DEFAULT_TAG}"

if [ "$cmd" = "clone" ]; then
  if [ -d "$DARIO_DIR/.git" ]; then
    echo "[setup-dario] $DARIO_DIR already cloned; use 'update' to sync."
    exit 0
  fi
  echo "[setup-dario] cloning fork at ${tag}..."
  rm -rf "$DARIO_DIR"
  git clone --quiet "$FORK_URL" "$DARIO_DIR"
  cd "$DARIO_DIR"
  git remote add upstream "$UPSTREAM_URL" 2>/dev/null || true
  git fetch --quiet upstream --tags
  git checkout "$tag"
  echo "[setup-dario] done: $(git describe --tags) at $(git rev-parse --short HEAD)"
  echo "[setup-dario] bundled CC template: $(grep -o '"_version": *"[^"]*"' dist/cc-template-data.json src/cc-template-data.json 2>/dev/null | head -1 | sed 's/.*"//;s/"$//')"
elif [ "$cmd" = "update" ]; then
  cd "$DARIO_DIR"
  git fetch --quiet upstream --tags
  echo "[setup-dario] latest upstream tags: $(git tag | grep -E '^v6' | tail -3 | tr '\n' ' ')"
  echo "[setup-dario] to pin a new version: git checkout <tag> && git push origin HEAD:master"
else
  echo "usage: $0 [clone [tag] | update]"
  exit 1
fi
