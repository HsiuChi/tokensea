#!/bin/bash
# Lisa H2 capture script - run AFTER CC auth login is done
# Usage: bash /root/capture/run-capture.sh

set -e
export PATH="/root/.bun/bin:$PATH"

echo "=== Step 1: Verify CC auth ==="
claude auth status

echo ""
echo "=== Step 2: Starting mitmproxy ==="
mitmdump -s /root/capture/mitm-h2-capture.py -q &
MITM_PID=$!
sleep 2

echo ""
echo "=== Step 3: Running CC through mitmproxy ==="
NODE_TLS_REJECT_UNAUTHORIZED=0 \
HTTPS_PROXY=http://127.0.0.1:8080 \
claude -p "say hello in one word" --max-turns 1 2>&1 || true

echo ""
echo "=== Step 4: Stopping mitmproxy ==="
kill $MITM_PID 2>/dev/null || true
wait $MITM_PID 2>/dev/null || true

echo ""
echo "=== Step 5: Capture results ==="
echo "Lines captured:"
wc -l /root/capture/mitm-cc.jsonl

echo ""
echo "=== Step 6: Also capture raw H2 with tshark ==="
# Start tshark in background to capture H2 traffic
# Then make a direct CC request (no proxy) to see real H2 negotiation
timeout 15 tshark -i any -f "host api.anthropic.com" \
  -Y "tcp.port==443" \
  -T fields \
  -e frame.time_epoch \
  -e ip.src -e ip.dst \
  -e tcp.stream \
  -e tls.handshake.type \
  -e tls.handshake.extensions_server_name \
  -e tls.handshake.ciphersuites \
  -e http2.settings.id \
  -e http2.settings.value \
  -e http2.type \
  > /root/capture/tshark-raw.tsv 2>/dev/null &

TSHARK_PID=$!
sleep 1

# Make a direct CC request for tshark to capture
claude -p "say hi" --max-turns 1 2>&1 || true

sleep 3
kill $TSHARK_PID 2>/dev/null || true
wait $TSHARK_PID 2>/dev/null || true

echo ""
echo "=== Results ==="
echo "mitm-cc.jsonl:"
cat /root/capture/mitm-cc.jsonl
echo ""
echo "tshark-raw.tsv (first 20 lines):"
head -20 /root/capture/tshark-raw.tsv

echo ""
echo "=== Done ==="
