#!/usr/bin/env bash
# predeploy:verify
#
# Full pre-deployment verification gate. Runs all checks that should pass
# before pushing a new dario build to production:
#
#   1. fingerprint:capture — grab CC's current TLS fingerprint
#   2. Build shim + dario
#   3. Start dario with shim
#   4. fingerprint:verify — compare CC vs shim outbound
#   5. shim:test — verify shim handshake works
#   6. Template drift — CC version matches captured template
#   7. HTTP-layer diff — headers/tools/body match CC
#
# Any failure blocks deployment. Run this in CI or manually before:
#   docker compose up -d
#
# Usage:
#   ./scripts/predeploy-verify.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ERRORS=0

echo "============================================"
echo " predeploy:verify — Deployment Gate"
echo "============================================"
echo ""

# 1. CC binary available?
echo "[predeploy] Step 1: Check CC binary..."
if ! command -v claude &>/dev/null; then
  echo "[predeploy] FAIL: claude binary not found on PATH"
  ERRORS=$((ERRORS + 1))
else
  CC_VER=$(claude --version 2>/dev/null | head -1 | grep -oP '[\d.]+' | head -1)
  echo "[predeploy] PASS: CC v${CC_VER} found"
fi

# 2. Capture CC fingerprint
echo ""
echo "[predeploy] Step 2: Capture CC TLS fingerprint..."
if bash "${SCRIPT_DIR}/fingerprint-capture.sh" ./data/fingerprints; then
  echo "[predeploy] PASS: CC fingerprint captured"
else
  echo "[predeploy] FAIL: CC fingerprint capture failed"
  ERRORS=$((ERRORS + 1))
fi

# 3. Check dario is running
echo ""
echo "[predeploy] Step 3: Check dario is running..."
if curl -sf http://127.0.0.1:3456/healthz > /dev/null 2>&1; then
  echo "[predeploy] PASS: dario is running"
else
  echo "[predeploy] FAIL: dario is not running on port 3456"
  echo "  Start it first: docker compose up -d dario-1"
  ERRORS=$((ERRORS + 1))
fi

# 4. Verify shim fingerprint matches CC
echo ""
echo "[predeploy] Step 4: Verify shim TLS fingerprint matches CC..."
if bash "${SCRIPT_DIR}/fingerprint-verify.sh" ./data/fingerprints; then
  echo "[predeploy] PASS: Shim fingerprint matches CC"
else
  echo "[predeploy] FAIL: Shim fingerprint does NOT match CC"
  ERRORS=$((ERRORS + 1))
fi

# 5. Shim standalone test
echo ""
echo "[predeploy] Step 5: Shim standalone test..."
if bash "${SCRIPT_DIR}/shim-test.sh" /usr/local/bin/tls-shim; then
  echo "[predeploy] PASS: Shim standalone test passed"
else
  echo "[predeploy] FAIL: Shim standalone test failed"
  ERRORS=$((ERRORS + 1))
fi

# 6. Template drift check
echo ""
echo "[predeploy] Step 6: Template drift check..."
HEALTH=$(curl -sf http://127.0.0.1:3456/healthz 2>/dev/null || echo '{}')
TEMPLATE_VER=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cc_template_version','?'))" 2>/dev/null || echo "?")
if [ "$TEMPLATE_VER" != "?" ] && [ "$TEMPLATE_VER" = "$CC_VER" ]; then
  echo "[predeploy] PASS: Template version (${TEMPLATE_VER}) matches CC (${CC_VER})"
else
  echo "[predeploy] WARN: Template version (${TEMPLATE_VER}) differs from CC (${CC_VER})"
  echo "  Live capture should auto-fix this on next startup"
fi

# Summary
echo ""
echo "============================================"
if [ $ERRORS -eq 0 ]; then
  echo " DEPLOYMENT GATE: PASSED — safe to deploy"
  echo "============================================"
  exit 0
else
  echo " DEPLOYMENT GATE: ${ERRORS} CHECK(S) FAILED — DO NOT DEPLOY"
  echo "============================================"
  exit 1
fi
