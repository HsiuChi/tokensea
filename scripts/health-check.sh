#!/usr/bin/env bash
# TokenSea Health Check Script
#
# Batch-check health of all dario nodes and the CPA gateway.
#
# Usage:
#   ./health-check.sh                    # Check all nodes on localhost
#   ./health-check.sh --host 192.204.62.165  # Check remote deployment
#   ./health-check.sh --watch             # Continuous watch mode (every 10s)

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CPA_HOST="${CPA_HOST:-localhost}"
CPA_PORT="${CPA_PORT:-8080}"
WATCH_MODE=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)  CPA_HOST="$2"; shift 2 ;;
    --watch) WATCH_MODE=true; shift ;;
    *)       shift ;;
  esac
done

check_dario_node() {
  local host="$1"
  local port="${2:-3456}"
  local name="${3:-}"

  local response
  response=$(curl -sf -m 5 "http://${host}:${port}/healthz" 2>/dev/null) || {
    echo -e "  ${RED}DOWN${NC}  ${name:-${host}:${port}} — unreachable"
    return 1
  }

  local status account_id oauth_status runtime concurrent uptime
  status=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "?")
  account_id=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('account_id','?'))" 2>/dev/null || echo "?")
  oauth_status=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('oauth_status','?'))" 2>/dev/null || echo "?")
  runtime=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('runtime','?'))" 2>/dev/null || echo "?")
  concurrent=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('concurrent_requests','?'))" 2>/dev/null || echo "?")
  uptime=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uptime_seconds','?'))" 2>/dev/null || echo "?")

  local status_color
  case "$status" in
    healthy) status_color="$GREEN" ;;
    degraded) status_color="$YELLOW" ;;
    down) status_color="$RED" ;;
    *) status_color="$RED" ;;
  esac

  local oauth_color
  case "$oauth_status" in
    valid) oauth_color="$GREEN" ;;
    expired) oauth_color="$RED" ;;
    *) oauth_color="$YELLOW" ;;
  esac

  echo -e "  ${status_color}${status}${NC}  ${name:-${host}:${port}}  account=${account_id}  oauth=${oauth_color}${oauth_status}${NC}  runtime=${runtime}  concurrent=${concurrent}  uptime=${uptime}s"
}

check_cpa() {
  local response
  response=$(curl -sf -m 5 "http://${CPA_HOST}:${CPA_PORT}/v1/models" 2>/dev/null) || {
    echo -e "  ${RED}DOWN${NC}  CPA (${CPA_HOST}:${CPA_PORT}) — unreachable"
    return 1
  }
  echo -e "  ${GREEN}OK${NC}    CPA (${CPA_HOST}:${CPA_PORT}) — responding"
}

run_check() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║      TokenSea Health Check           ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
  echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo ""

  echo "  CPA Gateway:"
  check_cpa || true

  echo ""
  echo "  Dario Nodes:"

  # Check Docker-based nodes
  if command -v docker &>/dev/null; then
    local containers
    containers=$(docker ps --filter "name=tokensea-dario-" --format "{{.Names}} {{.Ports}}" 2>/dev/null || true)
    if [[ -n "$containers" ]]; then
      while IFS=' ' read -r name ports; do
        # Extract the dario number from container name
        local num
        num=$(echo "$name" | sed 's/tokensea-dario-//')
        # Check via Docker network (container name)
        check_dario_node "tokensea-dario-${num}" 3456 "dario-${num}" || true
      done <<< "$containers"
    else
      # Fallback: try localhost with sequential ports
      for i in 1 2 3 4 5; do
        check_dario_node "localhost" $((3456 + i - 1)) "dario-${i}" 2>/dev/null || true
      done
    fi
  else
    # No Docker, try sequential ports on CPA host
    for i in 1 2 3; do
      check_dario_node "$CPA_HOST" 3456 "dario-${i}" 2>/dev/null || true
    done
  fi

  echo ""
}

if $WATCH_MODE; then
  while true; do
    clear
    run_check
    sleep 10
  done
else
  run_check
fi
