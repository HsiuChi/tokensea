#!/usr/bin/env bash
# TokenSea OAuth Credential Initialization Script
#
# This script helps initialize OAuth credentials for Team seats or Max subscriptions.
# It supports two modes:
#   1. Interactive: enter credentials for each seat
#   2. Batch: import from a CSV or JSON file
#
# Usage:
#   ./init-credentials.sh                  # Interactive mode
#   ./init-credentials.sh --file creds.csv # Batch import from CSV
#   ./init-credentials.sh --file creds.json # Batch import from JSON
#
# For Team accounts:
#   Each seat is a unique user. Obtain per-user credentials from their machine:
#     - OAuth tokens: ~/.claude/.credentials.json → claudeAiOauth.{accessToken, refreshToken, expiresAt}
#     - Device ID:    ~/.claude/.claude.json → userID
#     - Account UUID: ~/.claude/.claude.json → oauthAccount.accountUuid
#
# CSV format (one seat per line):
#   accessToken,refreshToken,expiresAt,deviceId,accountUuid,seatLabel
#
# JSON format:
#   [
#     {"accessToken": "...", "refreshToken": "...", "expiresAt": 0,
#      "deviceId": "...", "accountUuid": "...", "seatLabel": "seat-1"}
#   ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Write credentials to .env file for a given seat number
write_seat_env() {
  local seat_num="$1"
  local access_token="$2"
  local refresh_token="$3"
  local expires_at="$4"
  local device_id="$5"
  local account_uuid="$6"
  local seat_label="$7"
  local scopes="${8:-user:inference}"

  # Create .env if it doesn't exist
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
    info "Created .env from .env.example"
  fi

  # Update values in .env file
  local prefix="DARIO_${seat_num}"
  sed -i.bak "s|^${prefix}_OAUTH_ACCESS_TOKEN=.*|${prefix}_OAUTH_ACCESS_TOKEN=${access_token}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_OAUTH_REFRESH_TOKEN=.*|${prefix}_OAUTH_REFRESH_TOKEN=${refresh_token}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_OAUTH_EXPIRES_AT=.*|${prefix}_OAUTH_EXPIRES_AT=${expires_at}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_OAUTH_SCOPES=.*|${prefix}_OAUTH_SCOPES=${scopes}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_DEVICE_ID=.*|${prefix}_DEVICE_ID=${device_id}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_ACCOUNT_UUID=.*|${prefix}_ACCOUNT_UUID=${account_uuid}|" "$ENV_FILE"
  sed -i.bak "s|^${prefix}_ACCOUNT_ID=.*|${prefix}_ACCOUNT_ID=${seat_label}|" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"

  info "Seat ${seat_num} (${seat_label}) credentials written to .env"
}

# Interactive mode — prompt for each seat
interactive_mode() {
  local seat_num=1

  echo ""
  echo "For Team accounts, each seat corresponds to a user in your organization."
  echo "You will need the following from each user's machine:"
  echo "  1. OAuth tokens from ~/.claude/.credentials.json"
  echo "  2. Device ID (userID) from ~/.claude/.claude.json"
  echo "  3. Account UUID from ~/.claude/.claude.json"
  echo ""

  while true; do
    echo ""
    echo "=== Seat ${seat_num} ==="
    echo "Press Enter with empty Access Token to finish."

    read -rp "Access Token: " access_token
    [[ -z "$access_token" ]] && break

    read -rp "Refresh Token: " refresh_token
    read -rp "Expires At (ms timestamp, or Enter for 0): " expires_at
    expires_at="${expires_at:-0}"
    read -rp "Device ID (userID from ~/.claude/.claude.json): " device_id
    read -rp "Account UUID (from ~/.claude/.claude.json): " account_uuid
    read -rp "Seat Label [seat-${seat_num}]: " seat_label
    seat_label="${seat_label:-seat-${seat_num}}"

    write_seat_env "$seat_num" "$access_token" "$refresh_token" "$expires_at" \
      "$device_id" "$account_uuid" "$seat_label"

    ((seat_num++))
  done

  info "Finished configuring $((seat_num - 1)) seats"
}

# Batch import from CSV file
# CSV format: accessToken,refreshToken,expiresAt,deviceId,accountUuid,seatLabel
import_csv() {
  local csv_file="$1"
  local seat_num=1

  [[ ! -f "$csv_file" ]] && { error "File not found: $csv_file"; exit 1; }

  while IFS=, read -r access_token refresh_token expires_at device_id account_uuid seat_label; do
    [[ -z "$access_token" || "$access_token" == accessToken ]] && continue

    seat_label="${seat_label:-seat-${seat_num}}"
    expires_at="${expires_at:-0}"

    info "Importing seat ${seat_num}: ${seat_label}"
    write_seat_env "$seat_num" "$access_token" "$refresh_token" "$expires_at" \
      "$device_id" "$account_uuid" "$seat_label"

    ((seat_num++))
  done < "$csv_file"

  info "Imported $((seat_num - 1)) seats from CSV"
}

# Batch import from JSON file
import_json() {
  local json_file="$1"

  [[ ! -f "$json_file" ]] && { error "File not found: $json_file"; exit 1; }

  if command -v jq &>/dev/null; then
    local count
    count=$(jq 'length' "$json_file")
    for ((i=0; i<count; i++)); do
      local seat_num=$((i + 1))
      local access_token refresh_token expires_at device_id account_uuid seat_label
      access_token=$(jq -r ".[$i].accessToken // empty" "$json_file")
      refresh_token=$(jq -r ".[$i].refreshToken // empty" "$json_file")
      expires_at=$(jq -r ".[$i].expiresAt // 0" "$json_file")
      device_id=$(jq -r ".[$i].deviceId // empty" "$json_file")
      account_uuid=$(jq -r ".[$i].accountUuid // empty" "$json_file")
      seat_label=$(jq -r ".[$i].seatLabel // \"seat-${seat_num}\"" "$json_file")

      info "Importing seat ${seat_num}: ${seat_label}"
      write_seat_env "$seat_num" "$access_token" "$refresh_token" "$expires_at" \
        "$device_id" "$account_uuid" "$seat_label"
    done
    info "Imported ${count} seats from JSON"
  else
    error "jq is required for JSON import. Install it with: apt-get install jq / brew install jq"
    exit 1
  fi
}

# Main
main() {
  echo "╔══════════════════════════════════════╗"
  echo "║   TokenSea Credential Initializer    ║"
  echo "║   (Team & Max Account Support)       ║"
  echo "╚══════════════════════════════════════╝"
  echo ""

  if [[ "${1:-}" == "--file" && -n "${2:-}" ]]; then
    local import_file="$2"
    case "$import_file" in
      *.csv)  import_csv "$import_file" ;;
      *.json) import_json "$import_file" ;;
      *)      error "Unsupported file format. Use .csv or .json"; exit 1 ;;
    esac
  else
    interactive_mode
  fi

  echo ""
  info "Credentials saved to: ${ENV_FILE}"
  info "Next steps:"
  info "  1. Review .env and fill in any missing values"
  info "  2. Set DARIO_ACCOUNT_TYPE=team (or max) in .env"
  info "  3. Run: docker compose up -d"
  info "  4. Verify: curl http://localhost:8080/v1/models"
}

main "$@"
