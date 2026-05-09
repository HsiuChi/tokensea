#!/usr/bin/env bash
# fingerprint:capture (container-aware version)
#
# Captures real Claude Code's TLS fingerprint. Designed to run on the host
# where dario's Docker container is running. Uses tcpdump on the host and
# triggers CC inside the container.
#
# Usage:
#   ./scripts/fingerprint-capture.sh [output-dir] [container-name]
#
# Output:
#   <output-dir>/claude-code-<version>-<platform>.json

set -uo pipefail

OUTPUT_DIR="${1:-./data/fingerprints}"
CONTAINER="${2:-tokensea-dario-1}"
mkdir -p "$OUTPUT_DIR"

# Get CC version from inside container
CC_VER=$(docker exec "$CONTAINER" claude --version 2>/dev/null | head -1 | grep -oP '[\d.]+' | head -1 || echo "unknown")
PLATFORM="linux-x86_64"

echo "[capture] Claude Code version: ${CC_VER}"
echo "[capture] Platform: ${PLATFORM}"
echo "[capture] Container: ${CONTAINER}"

# Capture on host — sees all container traffic
PCAP_FILE="/tmp/cc_fingerprint_$$.pcap"
echo "[capture] Starting packet capture on host..."

timeout 30 tcpdump -i any -w "$PCAP_FILE" \
  'host api.anthropic.com and port 443' \
  -c 20 2>/dev/null &
TCPDUMP_PID=$!
sleep 1

# Trigger CC inside the container (will fail auth but TLS handshake completes)
echo "[capture] Triggering CC connection inside container..."
docker exec -e ANTHROPIC_API_KEY=sk-ant-capture-test "$CONTAINER" \
  claude --print 'ping' --model claude-haiku-4-5-20251001 2>/dev/null || true

# Wait for capture
wait $TCPDUMP_PID 2>/dev/null || true
sleep 1

if [ ! -s "$PCAP_FILE" ]; then
  echo "[capture] ERROR: No packets captured" >&2
  exit 1
fi

echo "[capture] Captured $(tcpdump -r "$PCAP_FILE" 2>/dev/null | wc -l) packets"

# Extract fingerprint using tshark
echo "[capture] Extracting TLS fingerprint..."

# Get CC's container IP to filter its traffic
CC_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER" 2>/dev/null | head -1)

# Extensions — filter by CC's IP if available
EXTRACT_EXT="grep 'Extension:' | grep -oP '\\d+\\.?\\d* \\(len' | grep -oP '^\\d+' | sed 's/^0*//' | paste -sd '-' -"
EXTRACT_CIPHER="grep 'Cipher Suite:' | grep -oP '0x[0-9a-fA-F]+' | sed 's/0x//' | paste -sd '-' -"

if [ -n "$CC_IP" ]; then
  FILTER="ip.src==$CC_IP && tls.handshake.type == 1"
else
  FILTER="tls.handshake.type == 1"
fi

EXTENSIONS=$(tshark -r "$PCAP_FILE" -Y "$FILTER" -V 2>/dev/null \
  | grep -A1 'Extension:' \
  | grep 'Type:' \
  | grep -oP '\d+' \
  | paste -sd '-' - \
  | head -1)

CIPHERS=$(tshark -r "$PCAP_FILE" -Y "$FILTER" -V 2>/dev/null \
  | grep 'Cipher Suite:' \
  | grep -oP '0x[0-9a-fA-F]+' \
  | sed 's/0x//' \
  | paste -sd '-' - \
  | head -1)

GROUPS=$(tshark -r "$PCAP_FILE" -Y "$FILTER" -V 2>/dev/null \
  | grep -A5 'Supported Groups' \
  | grep -oP '0x[0-9a-fA-F]+' \
  | sed 's/0x//' \
  | paste -sd '-' - \
  | head -1)

ALPN=$(tshark -r "$PCAP_FILE" -Y "$FILTER" -V 2>/dev/null \
  | grep 'ALPN protocol' \
  | head -1 \
  | grep -oP 'http[/\d.]+' \
  | head -1)

HAS_H2="false"
if echo "$ALPN" | grep -q "h2"; then
  HAS_H2="true"
fi

HAS_ECH="false"
if echo "$EXTENSIONS" | grep -q "65037"; then
  HAS_ECH="true"
fi

EXT_COUNT=$(echo "$EXTENSIONS" | tr '-' '\n' | wc -l | tr -d ' ')
CIPHER_COUNT=$(echo "$CIPHERS" | tr '-' '\n' | wc -l | tr -d ' ')
JA3_STR="${CIPHERS}-${EXTENSIONS}-${GROUPS}"

# Build JSON
OUTPUT_FILE="${OUTPUT_DIR}/claude-code-${CC_VER}-${PLATFORM}.json"
cat > "$OUTPUT_FILE" << EOF
{
  "version": "${CC_VER}",
  "platform": "${PLATFORM}",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ja3_string": "${JA3_STR}",
  "extensions": "${EXTENSIONS}",
  "cipher_suites": "${CIPHERS}",
  "supported_groups": "${GROUPS}",
  "alpn": "${ALPN:-http/1.1}",
  "has_h2": ${HAS_H2},
  "has_ech_65037": ${HAS_ECH},
  "extension_count": ${EXT_COUNT},
  "cipher_count": ${CIPHER_COUNT},
  "source": "fingerprint-capture"
}
EOF

echo "[capture] Fingerprint saved to: ${OUTPUT_FILE}"
echo "[capture] Extensions: ${EXTENSIONS}"
echo "[capture] Ciphers: ${CIPHERS}"
echo "[capture] ALPN: ${ALPN:-http/1.1}"
echo "[capture] ECH(65037): ${HAS_ECH}"

rm -f "$PCAP_FILE"
