#!/usr/bin/env bash
# Clone/update the tokensea dario fork.
#
# dario-modified/ is a clone of https://github.com/HsiuChi/dario (fork of
# askalf/dario) with a tokensea overlay (tokensea-Dockerfile + tokensea-entrypoint.sh)
# on the tokensea-v6.0.17 branch. Excluded from the tokensea repo via .gitignore;
# must be cloned before `docker compose build dario-1`.
#
# Usage:
#   ./scripts/setup-dario.sh                      # clone at overlay branch (default)
#   ./scripts/setup-dario.sh clone tokensea-v6.0.17
#   ./scripts/setup-dario.sh update               # git fetch upstream + tags
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DARIO_DIR="$ROOT/dario-modified"
FORK_URL="https://github.com/HsiuChi/dario.git"
UPSTREAM_URL="https://github.com/askalf/dario.git"
# The tokensea overlay lives on this branch (v6.0.17 + overlay commits).
DEFAULT_REF="tokensea-v6.0.17"

cmd="${1:-clone}"
ref="${2:-$DEFAULT_REF}"

if [ "$cmd" = "clone" ]; then
  if [ -d "$DARIO_DIR/.git" ]; then
    echo "[setup-dario] $DARIO_DIR already cloned; use 'update' to sync."
    exit 0
  fi
  echo "[setup-dario] cloning fork at ${ref}..."
  rm -rf "$DARIO_DIR"
  git clone --quiet "$FORK_URL" "$DARIO_DIR"
  cd "$DARIO_DIR"
  git remote add upstream "$UPSTREAM_URL" 2>/dev/null || true
  git fetch --quiet upstream --tags
  git checkout "$ref"
  echo "[setup-dario] done: ${ref} at $(git rev-parse --short HEAD)"
  echo "[setup-dario] bundled CC template: $(grep -m1 '"_version"' dist/cc-template-data.json src/cc-template-data.json 2>/dev/null | cut -d'"' -f4)"
elif [ "$cmd" = "update" ]; then
  cd "$DARIO_DIR"
  git fetch --quiet origin
  git fetch --quiet upstream --tags
  echo "[setup-dario] latest upstream tags: $(git tag | grep -E '^v6' | tail -3 | tr '\n' ' ')"
  echo "[setup-dario] to rebase overlay onto newer upstream: git rebase upstream/<newtag> && git push origin ${DEFAULT_REF}"
else
  echo "usage: $0 [clone [ref] | update]"
  exit 1
fi
