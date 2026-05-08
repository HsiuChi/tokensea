#!/bin/bash
set -euo pipefail

# ── Build the Rust tls-shim ──────────────────────────────────────
echo "Building tls-shim (Rust)..."
cd "$(dirname "$0")/tls-shim"
cargo build --release
echo "tls-shim built: target/release/tls-shim"

# ── Build the TypeScript ─────────────────────────────────────────
echo "Building codex-dario (TypeScript)..."
cd "$(dirname "$0")"
bun install
bun run build
echo "codex-dario built: dist/"

echo ""
echo "Build complete. Run with:"
echo "  bun run dist/cli.js proxy"
echo ""
echo "For Docker:"
echo "  docker build -t codex-dario ."
