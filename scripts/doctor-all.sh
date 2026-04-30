#!/usr/bin/env bash
# TokenSea Doctor-All Script
#
# Run 'dario doctor' on all dario nodes to check their health and configuration.
#
# Usage:
#   ./doctor-all.sh                   # Run doctor on all nodes
#   ./doctor-all.sh --verbose         # Verbose output

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

VERBOSE=false
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE=true

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      TokenSea Doctor-All             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# Find all running dario containers
if ! command -v docker &>/dev/null; then
  error "Docker is not installed. This script requires Docker to find dario containers."
  exit 1
fi

containers=$(docker ps --filter "name=tokensea-dario-" --format "{{.Names}}" 2>/dev/null || true)

if [[ -z "$containers" ]]; then
  warn "No tokensea-dario containers found running."
  echo "Start them with: docker compose up -d"
  exit 0
fi

total=0
healthy=0
unhealthy=0

for container in $containers; do
  total=$((total + 1))
  echo -e "${CYAN}━━━ ${container} ━━━${NC}"

  # Run dario doctor inside the container
  local_output=$(docker exec "$container" bun run dist/cli.js doctor 2>&1) || {
    error "Doctor check failed for ${container}"
    unhealthy=$((unhealthy + 1))
    if $VERBOSE; then
      echo "$local_output"
    fi
    echo ""
    continue
  }

  # Check the exit status
  if echo "$local_output" | grep -qi "error\|fail\|drift"; then
    warn "${container}: issues detected"
    unhealthy=$((unhealthy + 1))
  else
    info "${container}: healthy"
    healthy=$((healthy + 1))
  fi

  if $VERBOSE; then
    echo "$local_output"
  else
    # Show summary lines only
    echo "$local_output" | grep -E "^\[dario\]" | head -10
  fi

  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Total: ${total}  ${GREEN}Healthy: ${healthy}${NC}  ${RED}Unhealthy: ${unhealthy}${NC}"

if [[ $unhealthy -gt 0 ]]; then
  exit 1
fi
