#!/usr/bin/env bash
# codex-dario Token Refresh — captures fresh OAuth token from Codex CLI
# and pushes it to the remote server.
#
# Usage:
#   ./scripts/refresh-codex-token.sh [LISA_HOST] [LISA_DIR]
#
# Cron (refresh weekly, tokens last ~10 days):
#   0 3 * * 1 /path/to/codex-dario/scripts/refresh-codex-token.sh
#
# Prerequisites:
#   - Codex CLI installed and logged in (codex login status → "Logged in using ChatGPT")
#   - SSH access to the remote server
#   - Node.js >= 18

set -euo pipefail

LISA_HOST="${1:-lisa}"
LISA_DIR="${2:-~/tokensea}"
CAPTURE_PORT=19881
TIMEOUT_SEC=30

echo "[refresh] Capturing fresh token from Codex CLI on localhost..."

# ── Step 1: Start the capture server and trigger Codex CLI ──────
# The capture server intercepts the first API request from Codex CLI
# and extracts the Authorization header (Bearer access_token).
# This works because `codex -c chatgpt_base_url=...` redirects API calls.

CAPTURED=$(node -e '
const http = require("http");
let done = false;
const server = http.createServer((req, res) => {
  if (done) { res.writeHead(200); res.end("{}"); return; }
  const auth = req.headers["authorization"];
  const accountId = req.headers["chatgpt-account-id"];
  if (auth && auth.startsWith("Bearer ")) {
    done = true;
    const token = auth.substring(7);
    let expiresAt = 0;
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
      expiresAt = payload.exp * 1000;
      const planType = payload["https://api.openai.com/auth"]?.chatgpt_plan_type || "unknown";
      const chatgptAccountId = payload["https://api.openai.com/auth"]?.chatgpt_account_id || accountId || "";
      process.stdout.write(JSON.stringify({ accessToken: token, expiresAt, chatgptAccountId, planType }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ accessToken: token, expiresAt: 0, chatgptAccountId: accountId || "", planType: "unknown" }));
    }
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({id:"cap",object:"response",status:"completed",output:[]}));
    setTimeout(() => process.exit(0), 500);
  } else {
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({id:"cap",object:"response",status:"completed",output:[]}));
  }
});
const PORT = process.env.CAPTURE_PORT || "19881";
server.listen(parseInt(PORT), "127.0.0.1", () => {
  process.stderr.write("[capture] Listening on port " + PORT + "\n");
});
setTimeout(() => { if (!done) { process.stderr.write("[capture] Timeout\n"); process.exit(1); } }, parseInt(process.env.TIMEOUT_MS || "30000"));
' 2>/tmp/codex-dario-capture-err.txt &

CAPTURE_PID=$!
sleep 1

# Trigger Codex CLI to make a request through our capture server
echo "[refresh] Triggering Codex CLI request (via chatgpt_base_url override)..."
codex -c "chatgpt_base_url=http://127.0.0.1:$CAPTURE_PORT" exec "say hi" 2>/dev/null || true

# Wait for capture
sleep 2

# Get captured output
CAPTURED=$(wait $CAPTURE_PID 2>/dev/null && echo "success" || echo "failed")

# Read the actual captured data from the node process stdout
# Since we backgrounded it, we need a different approach
kill $CAPTURE_PID 2>/dev/null || true
wait $CAPTURE_PID 2>/dev/null || true

# ── Alternative: run capture synchronously ──────────────────────
echo "[refresh] Running synchronous capture..."

RESULT=$(CAPTURE_PORT=$CAPTURE_PORT TIMEOUT_MS=$((TIMEOUT_SEC * 1000)) node -e '
const http = require("http");
const {spawn} = require("child_process");
let captured = null;
const server = http.createServer((req, res) => {
  const auth = req.headers["authorization"];
  const accountId = req.headers["chatgpt-account-id"];
  if (auth && auth.startsWith("Bearer ") && !captured) {
    const token = auth.substring(7);
    let expiresAt = 0, chatgptAccountId = accountId || "", planType = "unknown";
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
      expiresAt = payload.exp * 1000;
      planType = payload["https://api.openai.com/auth"]?.chatgpt_plan_type || "unknown";
      chatgptAccountId = payload["https://api.openai.com/auth"]?.chatgpt_account_id || accountId || "";
    } catch {}
    captured = { accessToken: token, expiresAt, chatgptAccountId, planType };
  }
  res.writeHead(200, {"Content-Type": "application/json"});
  res.end(JSON.stringify({id:"cap",object:"response",status:"completed",output:[]}));
});

const PORT = parseInt(process.env.CAPTURE_PORT || "19881");
server.listen(PORT, "127.0.0.1", () => {
  const codex = spawn("codex", ["-c", "chatgpt_base_url=http://127.0.0.1:" + PORT, "exec", "say hi"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  codex.stdin.end();
  codex.on("exit", () => {
    if (captured) {
      process.stdout.write(JSON.stringify(captured));
    } else {
      process.stderr.write("No token captured\n");
    }
    process.exit(captured ? 0 : 1);
  });
});

setTimeout(() => {
  if (!captured) {
    process.stderr.write("Timeout after " + (parseInt(process.env.TIMEOUT_MS || "30000") / 1000) + "s\n");
    process.exit(1);
  }
}, parseInt(process.env.TIMEOUT_MS || "30000"));
' 2>/tmp/codex-dario-capture-err.txt)

if [ -z "$RESULT" ]; then
  echo "[refresh] ERROR: No token captured. Is Codex CLI logged in?"
  echo "[refresh] Run 'codex login' first, then retry."
  cat /tmp/codex-dario-capture-err.txt 2>/dev/null
  exit 1
fi

# ── Step 2: Parse the captured data ────────────────────────────
ACCESS_TOKEN=$(echo "$RESULT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).accessToken)")
EXPIRES_AT=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).expiresAt))")
ACCOUNT_ID=$(echo "$RESULT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).chatgptAccountId)")
PLAN_TYPE=$(echo "$RESULT" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).planType)")

EXPIRY_DATE=$(date -r $((EXPIRES_AT / 1000)) "+%Y-%m-%d %H:%M UTC" 2>/dev/null || echo "unknown")
REMAINING_HOURS=$(node -e "console.log(((Number('$EXPIRES_AT') - Date.now()) / 3600000).toFixed(1))")

echo "[refresh] Token captured!"
echo "[refresh]   Plan: $PLAN_TYPE"
echo "[refresh]   Account: $ACCOUNT_ID"
echo "[refresh]   Expires: $EXPIRY_DATE (${REMAINING_HOURS}h remaining)"

# ── Step 3: Push to remote server ──────────────────────────────
echo "[refresh] Pushing to $LISA_HOST..."

# Update .env file
ssh "$LISA_HOST" bash -s << REMOTE_EOF
cd $LISA_DIR

# Update environment variables
sed -i 's|^CODEX_DARIO_1_OAUTH_ACCESS_TOKEN=.*|CODEX_DARIO_1_OAUTH_ACCESS_TOKEN=${ACCESS_TOKEN}|' .env
sed -i 's|^CODEX_DARIO_1_OAUTH_EXPIRES_AT=.*|CODEX_DARIO_1_OAUTH_EXPIRES_AT=${EXPIRES_AT}|' .env
sed -i 's|^CODEX_DARIO_1_CHATGPT_ACCOUNT_ID=.*|CODEX_DARIO_1_CHATGPT_ACCOUNT_ID=${ACCOUNT_ID}|' .env

# Restart container to pick up new env
docker compose up -d codex-dario-1

# Wait for health check
sleep 8

# Verify
HEALTH=\$(docker exec tokensea-codex-dario-1 curl -s http://localhost:3457/healthz 2>/dev/null || echo '{"status":"error"}')
echo "Health: \$HEALTH"
REMOTE_EOF

echo "[refresh] Done! Token will expire in ${REMAINING_HOURS} hours."
echo "[refresh] Run this script again before then to refresh."

# Cleanup
rm -f /tmp/codex-dario-capture-err.txt
