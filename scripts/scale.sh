#!/usr/bin/env bash
# TokenSea Dynamic Scaling Script
#
# Add or remove dario nodes (Team seats or Max subscriptions) and
# update CPA configuration automatically.
#
# Usage:
#   ./scale.sh add <seat_num>                        # Add a new dario node
#   ./scale.sh remove <seat_num>                     # Remove a dario node
#   ./scale.sh list                                  # List all nodes
#   ./scale.sh reload-cpa                            # Hot-reload CPA configuration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
CONFIG_FILE="${PROJECT_DIR}/config/config.yaml"
ENV_FILE="${PROJECT_DIR}/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Generate a dario service block for docker-compose.yml
generate_dario_service() {
  local num="$1"
  cat <<EOF

  dario-${num}:
    build:
      context: ./dario-modified
      dockerfile: Dockerfile
    container_name: tokensea-dario-${num}
    restart: unless-stopped
    environment:
      - DARIO_API_KEY=\${DARIO_INTERNAL_KEY_${num}}
      - DARIO_OAUTH_ACCESS_TOKEN=\${DARIO_${num}_OAUTH_ACCESS_TOKEN}
      - DARIO_OAUTH_REFRESH_TOKEN=\${DARIO_${num}_OAUTH_REFRESH_TOKEN}
      - DARIO_OAUTH_EXPIRES_AT=\${DARIO_${num}_OAUTH_EXPIRES_AT:-0}
      - DARIO_OAUTH_SCOPES=\${DARIO_${num}_OAUTH_SCOPES:-user:inference}
      - DARIO_DEVICE_ID=\${DARIO_${num}_DEVICE_ID:-}
      - DARIO_ACCOUNT_UUID=\${DARIO_${num}_ACCOUNT_UUID:-}
      - DARIO_ACCOUNT_ID=\${DARIO_${num}_ACCOUNT_ID:-seat-${num}}
      - DARIO_ACCOUNT_TYPE=\${DARIO_ACCOUNT_TYPE:-team}
      - DARIO_HOST=0.0.0.0
      - DARIO_LISTEN_PORT=3456
    expose:
      - "3456"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3456/healthz"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    networks:
      - tokensea
EOF
}

# Add a CPA upstream entry for a dario node
add_cpa_entry() {
  local num="$1"
  local key="${2:-dario-internal-key-${num}}"

  # Check if entry already exists
  if grep -q "http://dario-${num}:3456" "$CONFIG_FILE" 2>/dev/null; then
    warn "dario-${num} already exists in config.yaml, skipping"
    return
  fi

  # Add entry before the "# Add more seats" comment
  local entry="
  # Seat ${num}
  - key: \"${key}\"
    cloak:
      mode: \"never\"
    base-url: \"http://dario-${num}:3456\""

  if [[ -f "$CONFIG_FILE" ]]; then
    sed -i.bak "/# Add more seats/i\\${entry}" "$CONFIG_FILE"
    rm -f "${CONFIG_FILE}.bak"
    info "Added dario-${num} to config.yaml"
  else
    warn "config.yaml not found at ${CONFIG_FILE}"
  fi
}

# Remove a CPA upstream entry for a dario node
remove_cpa_entry() {
  local num="$1"

  if [[ -f "$CONFIG_FILE" ]]; then
    local tmp_file
    tmp_file=$(mktemp)
    awk "
      /# Seat ${num}/ { skip=4 }
      skip > 0 { skip--; next }
      { print }
    " "$CONFIG_FILE" > "$tmp_file"
    mv "$tmp_file" "$CONFIG_FILE"
    info "Removed dario-${num} from config.yaml"
  fi
}

# Add environment variables for a new seat to .env
add_env_entry() {
  local num="$1"

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
  fi

  # Check if entry already exists
  if grep -q "DARIO_${num}_" "$ENV_FILE" 2>/dev/null; then
    warn "Seat ${num} env vars already exist in .env"
    return
  fi

  cat >> "$ENV_FILE" <<EOF

# ============================================
# Seat ${num} (dario-${num})
# ============================================
DARIO_${num}_OAUTH_ACCESS_TOKEN=
DARIO_${num}_OAUTH_REFRESH_TOKEN=
DARIO_${num}_OAUTH_EXPIRES_AT=
DARIO_${num}_OAUTH_SCOPES=user:inference
DARIO_${num}_DEVICE_ID=
DARIO_${num}_ACCOUNT_UUID=
DARIO_${num}_ACCOUNT_ID=seat-${num}
EOF

  info "Added seat ${num} variables to .env"
}

# Remove environment variables for a seat from .env
remove_env_entry() {
  local num="$1"

  if [[ -f "$ENV_FILE" ]]; then
    local tmp_file
    tmp_file=$(mktemp)
    awk "
      /# Seat ${num} \(dario-${num}\)/ { skip=1 }
      /^DARIO_${num}_/ { skip=1; next }
      skip && /^$/ { skip=0; next }
      skip { next }
      { print }
    " "$ENV_FILE" > "$tmp_file"
    mv "$tmp_file" "$ENV_FILE"
    info "Removed seat ${num} variables from .env"
  fi
}

# Add a new dario node
cmd_add() {
  local num="${1:-}"
  if [[ -z "$num" ]]; then
    error "Usage: $0 add <seat_num>"
    exit 1
  fi

  info "Adding dario-${num} (seat ${num})..."

  # Add to .env
  add_env_entry "$num"

  # Add to CPA config
  add_cpa_entry "$num"

  # Add to docker-compose.yml — insert before the Prometheus section
  local service_block
  service_block=$(generate_dario_service "$num")
  if [[ -f "$COMPOSE_FILE" ]]; then
    sed -i.bak "/# ============/,/Prometheus/{
      /# Prometheus/i\\${service_block}
    }" "$COMPOSE_FILE" 2>/dev/null || {
      # Fallback: just append before Prometheus comment
      local tmp_file
      tmp_file=$(mktemp)
      awk "/# ============.*Prometheus/ { print service_block; print } next" \
        service_block="$service_block" \
        "$COMPOSE_FILE" > "$tmp_file"
      mv "$tmp_file" "$COMPOSE_FILE"
    }
    rm -f "${COMPOSE_FILE}.bak"
    info "Added dario-${num} to docker-compose.yml"
  fi

  info ""
  info "dario-${num} added. Next steps:"
  info "  1. Fill in credentials in .env for seat ${num}"
  info "  2. Run: docker compose up -d dario-${num}"
  info "  3. Verify: docker compose exec dario-${num} curl -f http://localhost:3456/healthz"
}

# Remove a dario node
cmd_remove() {
  local num="${1:-}"
  if [[ -z "$num" ]]; then
    error "Usage: $0 remove <seat_num>"
    exit 1
  fi

  info "Removing dario-${num} (seat ${num})..."

  # Stop the container first
  docker compose -f "$COMPOSE_FILE" stop "dario-${num}" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" rm -f "dario-${num}" 2>/dev/null || true

  # Remove from CPA config
  remove_cpa_entry "$num"

  # Remove from .env
  remove_env_entry "$num"

  # Remove from docker-compose.yml
  if [[ -f "$COMPOSE_FILE" ]]; then
    local tmp_file
    tmp_file=$(mktemp)
    awk "
      /^  dario-${num}:/ { skip=1 }
      skip && /^[^ ]/ { skip=0 }
      skip { next }
      { print }
    " "$COMPOSE_FILE" > "$tmp_file"
    mv "$tmp_file" "$COMPOSE_FILE"
    info "Removed dario-${num} from docker-compose.yml"
  fi

  info "dario-${num} removed."
}

# List all dario nodes
cmd_list() {
  info "Dario nodes (seats) in docker-compose.yml:"
  grep -E "^  dario-[0-9]+:" "$COMPOSE_FILE" 2>/dev/null || echo "  (none found)"

  echo ""
  info "Running containers:"
  docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || echo "  (compose not running)"

  echo ""
  info "Health status:"
  for container in $(docker ps --filter "name=tokensea-dario-" --format "{{.Names}}" 2>/dev/null); do
    local health
    health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
    echo "  ${container}: ${health}"
  done
}

# Hot-reload CPA configuration
cmd_reload_cpa() {
  info "Reloading CPA configuration..."
  # CPA supports hot-reload via SIGHUP or API
  docker compose -f "$COMPOSE_FILE" exec cpa kill -HUP 1 2>/dev/null || \
    docker compose -f "$COMPOSE_FILE" restart cpa
  info "CPA reloaded."
}

# Main
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    add)         cmd_add "$@" ;;
    remove)      cmd_remove "$@" ;;
    list)        cmd_list ;;
    reload-cpa)  cmd_reload_cpa ;;
    help|*)
      echo "TokenSea Scaling Tool (Team & Max Support)"
      echo ""
      echo "Usage: $0 <command> [args]"
      echo ""
      echo "Commands:"
      echo "  add <num>        Add a new dario node (Team seat or Max account)"
      echo "  remove <num>     Remove a dario node"
      echo "  list             List all nodes and their status"
      echo "  reload-cpa       Hot-reload CPA configuration"
      ;;
  esac
}

main "$@"
