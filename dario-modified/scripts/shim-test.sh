#!/usr/bin/env bash
# shim:test
#
# Quick test that the TLS shim can establish a connection to api.anthropic.com
# and produce a ClientHello without ECH(65037). Does NOT require dario running.
#
# Usage:
#   ./scripts/shim-test.sh [shim-binary-path]

set -euo pipefail

SHIM_BIN="${1:-/usr/local/bin/tls-shim}"
PCAP_FILE="/tmp/shim_test_$$.pcap"

echo "[shim:test] Testing TLS shim: ${SHIM_BIN}"

if [ ! -x "$SHIM_BIN" ]; then
  echo "[shim:test] ERROR: Shim binary not found at ${SHIM_BIN}" >&2
  exit 1
fi

# Start shim in background
TLS_SHIM_LISTEN_ADDR=127.0.0.1:13443 "$SHIM_BIN" &
SHIM_PID=$!
sleep 1

# Start capture
timeout 15 tcpdump -i any -w "$PCAP_FILE" \
  'host api.anthropic.com and port 443 and tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16' \
  -c 5 2>/dev/null &
TCPDUMP_PID=$!
sleep 1

# Send request through shim
curl -s -X POST http://127.0.0.1:13443/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: sk-ant-test' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"test"}]}' \
  --max-time 10 > /dev/null 2>&1 || true

wait $TCPDUMP_PID 2>/dev/null || true
sleep 1

# Kill shim
kill $SHIM_PID 2>/dev/null || true

# Analyze
ERRORS=0

if [ ! -s "$PCAP_FILE" ]; then
  echo "[shim:test] FAIL: No TLS packets captured" >&2
  exit 1
fi

# Check for ECH
HAS_ECH=$(tshark -r "$PCAP_FILE" -Y 'tls.handshake.type == 1' -V 2>/dev/null \
  | grep 'Type: Unknown (65037)' \
  | head -1)

if [ -z "$HAS_ECH" ]; then
  echo "[shim:test] PASS: No ECH(65037) extension"
else
  echo "[shim:test] FAIL: ECH(65037) extension found in ClientHello"
  ERRORS=$((ERRORS + 1))
fi

# Check ALPN
ALPN=$(tshark -r "$PCAP_FILE" -Y 'tls.handshake.type == 1' -V 2>/dev/null \
  | grep 'ALPN protocol' \
  | head -1 \
  | grep -oP 'http[/\d.]+' \
  | head -1)

if [ "$ALPN" = "http/1.1" ]; then
  echo "[shim:test] PASS: ALPN is http/1.1"
else
  echo "[shim:test] FAIL: ALPN is '${ALPN}', expected http/1.1"
  ERRORS=$((ERRORS + 1))
fi

# Check ServerHello received (handshake completed)
SERVER_HELLO=$(tshark -r "$PCAP_FILE" -Y 'tls.handshake.type == 2' 2>/dev/null | head -1)
if [ -n "$SERVER_HELLO" ]; then
  echo "[shim:test] PASS: TLS handshake completed"
else
  echo "[shim:test] FAIL: No ServerHello — handshake may have failed"
  ERRORS=$((ERRORS + 1))
fi

rm -f "$PCAP_FILE"

if [ $ERRORS -eq 0 ]; then
  echo "[shim:test] === ALL CHECKS PASSED ==="
  exit 0
else
  echo "[shim:test] === ${ERRORS} CHECK(S) FAILED ===" >&2
  exit 1
fi
