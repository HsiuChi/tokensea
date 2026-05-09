#!/usr/bin/env bash
# fingerprint:verify (container-aware version)
#
# Compares the latest captured CC fingerprint against the shim's actual
# outbound fingerprint. Runs on the host, captures shim traffic from
# the dario container.
#
# Usage:
#   ./scripts/fingerprint-verify.sh [fingerprint-dir] [container-name]
#
# Exits non-zero on mismatch (hard gate).

set -uo pipefail

FP_DIR="${1:-./data/fingerprints}"
CONTAINER="${2:-tokensea-dario-1}"
FORCE_RESTART=0
if [ "${3:-}" = "--force-restart" ]; then
  FORCE_RESTART=1
fi
SHIM_PCAP="/tmp/shim_verify_$$.pcap"
ERRORS=0

echo "[verify] === Fingerprint Verification ==="

# Find latest CC fingerprint
CC_FP=$(ls -t "${FP_DIR}"/claude-code-*.json 2>/dev/null | head -1)
if [ -z "$CC_FP" ]; then
  echo "[verify] ERROR: No CC fingerprint found in ${FP_DIR}" >&2
  echo "[verify] Run fingerprint:capture first" >&2
  exit 1
fi

echo "[verify] CC fingerprint: $(basename "$CC_FP")"

# Parse CC fingerprint
CC_EXT=$(python3 -c "import json; print(json.load(open('$CC_FP'))['extensions'])")
CC_CIPHERS=$(python3 -c "import json; print(json.load(open('$CC_FP'))['cipher_suites'])")
CC_ALPN=$(python3 -c "import json; print(json.load(open('$CC_FP'))['alpn'])")
CC_VER=$(python3 -c "import json; print(json.load(open('$CC_FP'))['version'])")

echo "[verify] CC version: ${CC_VER}"
echo "[verify] CC extensions: ${CC_EXT}"
echo "[verify] CC ciphers: ${CC_CIPHERS}"
echo "[verify] CC ALPN: ${CC_ALPN}"

# Get dario's internal API key
DARIO_KEY=$(docker exec "$CONTAINER" printenv DARIO_API_KEY 2>/dev/null || echo "ts-internal-1")
DARIO_PORT=$(docker exec "$CONTAINER" printenv DARIO_LISTEN_PORT 2>/dev/null || echo "3456")

# Get container IP
CC_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER" 2>/dev/null | head -1)
echo "[verify] Container IP: ${CC_IP:-<not found>}"

# Force a fresh TLS handshake so we can capture the ClientHello.
# --force-restart restarts the container (disrupts live traffic!).
# Default: just send a request — if shim was recently started or
# connections have gone idle, a new TLS handshake will happen anyway.
if [ "$FORCE_RESTART" -eq 1 ]; then
  echo "[verify] Restarting dario to force new TLS handshake (--force-restart)..."
  docker restart "$CONTAINER" > /dev/null 2>&1
  sleep 8
else
  echo "[verify] Sending warmup request to trigger TLS handshake..."
  curl -s -X POST "http://127.0.0.1:${DARIO_PORT}/v1/messages" \
    -H 'Content-Type: application/json' \
    -H "x-api-key: ${DARIO_KEY}" \
    -H 'anthropic-version: 2023-06-01' \
    -d '{"model":"claude-sonnet-4-5-20250514","max_tokens":1,"messages":[{"role":"user","content":"warmup"}]}' \
    --max-time 15 > /dev/null 2>&1 || true
  sleep 2
fi

echo "[verify] Capturing shim outbound..."
timeout 30 tcpdump -i any -w "$SHIM_PCAP" \
  "host api.anthropic.com and port 443" \
  -c 50 2>/dev/null &
TCPDUMP_PID=$!
sleep 1

# Send a test request through dario (which routes through shim)
curl -s -X POST "http://127.0.0.1:${DARIO_PORT}/v1/messages" \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${DARIO_KEY}" \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-sonnet-4-5-20250514","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}' \
  --max-time 15 > /dev/null 2>&1 || true

wait $TCPDUMP_PID 2>/dev/null || true
sleep 1

if [ ! -s "$SHIM_PCAP" ]; then
  echo "[verify] ERROR: No shim packets captured" >&2
  exit 1
fi

# Count ClientHello packets for diagnostics
CH_COUNT=$(tshark -r "$SHIM_PCAP" -Y "tls.handshake.type == 1" -T fields -e ip.src 2>/dev/null | sort -u | wc -l | tr -d ' ')
CH_TOTAL=$(tshark -r "$SHIM_PCAP" -Y "tls.handshake.type == 1" 2>/dev/null | wc -l | tr -d ' ')
echo "[verify] ClientHellos captured: ${CH_TOTAL} packets from ${CH_COUNT} unique source IPs"

# Build display filter — prefer container IP to avoid Docker NAT duplicates
if [ -n "$CC_IP" ]; then
  FILTER="ip.src==$CC_IP && tls.handshake.type == 1"
  # Verify this filter matches something
  FILTER_MATCH=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$FILTER_MATCH" -eq 0 ]; then
    echo "[verify] WARN: IP filter matched 0 packets, falling back to any ClientHello"
    FILTER="tls.handshake.type == 1"
  else
    echo "[verify] Using IP filter (matched ${FILTER_MATCH} ClientHello(s))"
  fi
else
  FILTER="tls.handshake.type == 1"
  echo "[verify] WARN: No container IP, using unfiltered ClientHello (may include NAT duplicates)"
fi

FIRST_CH_FRAME=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -T fields -e frame.number 2>/dev/null | head -1)
if [ -n "$FIRST_CH_FRAME" ]; then
  FILTER="frame.number==$FIRST_CH_FRAME"
  echo "[verify] Using first ClientHello frame (${FIRST_CH_FRAME})"
fi

SHIM_EXT=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -V 2>/dev/null \
  | grep -A1 'Extension:' \
  | grep 'Type:' \
  | grep -oP '\d+' \
  | paste -sd '-' - \
  | head -1)

SHIM_CIPHERS=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -V 2>/dev/null \
  | grep 'Cipher Suite:' \
  | grep -oP '0x[0-9a-fA-F]+' \
  | sed 's/0x//' \
  | paste -sd '-' - \
  | head -1)

SHIM_ALPN=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -V 2>/dev/null \
  | grep -E 'ALPN (Next )?[Pp]rotocol' \
  | grep -oP 'http[/\d.]+' \
  | head -1)

SHIM_HAS_ECH="false"
if echo "$SHIM_EXT" | grep -q "65037"; then
  SHIM_HAS_ECH="true"
fi

# Fallback: if primary extraction is empty, try python3 + tshark JSON
if [ -z "$SHIM_EXT" ] || [ -z "$SHIM_CIPHERS" ]; then
  echo "[verify] WARN: Primary extraction empty, trying JSON fallback..."
  SHIM_EXT=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -V 2>/dev/null \
    | grep -E 'Extension: [0-9]+' \
    | grep -oP '(?<=Extension: )\d+' \
    | paste -sd '-' - \
    | head -1)

  SHIM_CIPHERS=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" -V 2>/dev/null \
    | grep -E 'Cipher Suite: 0x[0-9a-fA-F]+' \
    | grep -oP '0x[0-9a-fA-F]+' \
    | sed 's/0x//' \
    | paste -sd '-' - \
    | head -1)
fi

# Final fallback: use tshark fields directly
if [ -z "$SHIM_EXT" ]; then
  echo "[verify] WARN: Still empty, trying tshark -T fields fallback..."
  SHIM_EXT=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" \
    -T fields -e tls.handshake.extensions_type 2>/dev/null \
    | tr '\t' '-' \
    | head -1)
fi

if [ -z "$SHIM_CIPHERS" ]; then
  SHIM_CIPHERS=$(tshark -r "$SHIM_PCAP" -Y "$FILTER" \
    -T fields -e tls.handshake.ciphersuite 2>/dev/null \
    | grep -oP '0x[0-9a-fA-F]+' \
    | sed 's/0x//' \
    | paste -sd '-' - \
    | head -1)
fi

echo "[verify] Shim extensions: ${SHIM_EXT:-<empty>}"
echo "[verify] Shim ciphers: ${SHIM_CIPHERS:-<empty>}"
echo "[verify] Shim ALPN: ${SHIM_ALPN:-<empty>}"
echo "[verify] Shim ECH(65037): ${SHIM_HAS_ECH}"

if [ -z "$SHIM_EXT" ] && [ -z "$SHIM_CIPHERS" ]; then
  echo "[verify] ERROR: Could not extract shim TLS fingerprint" >&2
  echo "[verify] Try running: tshark -r $SHIM_PCAP -Y 'tls.handshake.type==1' -V" >&2
  rm -f "$SHIM_PCAP"
  exit 1
fi

# Compare
echo ""
echo "[verify] === Comparison ==="

if [ "$CC_EXT" = "$SHIM_EXT" ]; then
  echo "[verify] PASS: Extensions match"
else
  echo "[verify] FAIL: Extensions mismatch"
  echo "  CC:   $CC_EXT"
  echo "  Shim: $SHIM_EXT"
  ERRORS=$((ERRORS + 1))
fi

if [ "$CC_CIPHERS" = "$SHIM_CIPHERS" ]; then
  echo "[verify] PASS: Cipher suites match"
else
  echo "[verify] FAIL: Cipher suites mismatch"
  echo "  CC:   $CC_CIPHERS"
  echo "  Shim: $SHIM_CIPHERS"
  ERRORS=$((ERRORS + 1))
fi

if [ "$CC_ALPN" = "$SHIM_ALPN" ]; then
  echo "[verify] PASS: ALPN matches"
else
  echo "[verify] FAIL: ALPN mismatch (CC=$CC_ALPN, Shim=$SHIM_ALPN)"
  ERRORS=$((ERRORS + 1))
fi

if [ "$SHIM_HAS_ECH" = "false" ]; then
  echo "[verify] PASS: No ECH(65037) in shim"
else
  echo "[verify] FAIL: ECH(65037) present in shim"
  ERRORS=$((ERRORS + 1))
fi

if [ "$SHIM_ALPN" = "http/1.1" ]; then
  echo "[verify] PASS: HTTP version matches (http/1.1)"
else
  echo "[verify] FAIL: HTTP version mismatch (expected http/1.1)"
  ERRORS=$((ERRORS + 1))
fi

rm -f "$SHIM_PCAP"

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "[verify] === ALL CHECKS PASSED ==="
  exit 0
else
  echo "[verify] === ${ERRORS} CHECK(S) FAILED ===" >&2
  exit 1
fi
