#!/bin/bash
# CC headless auth helper - runs on Lisa
# Usage: bash /root/capture/auth-helper.sh
# Step 1: Outputs the login URL
# Step 2: Waits for code to be written to /root/capture/auth-code.txt

export PATH="/root/.bun/bin:$PATH"

echo "Starting CC auth login..."
echo ""

# Run claude auth login, redirect output to capture URL,
# feed code from file when ready
claude auth login </dev/null > /tmp/cc-auth-output.txt 2>&1 &
CC_PID=$!

# Wait for URL to appear
for i in $(seq 1 10); do
  if grep -q "visit:" /tmp/cc-auth-output.txt 2>/dev/null; then
    break
  fi
  sleep 1
done

# Extract and print URL
URL=$(grep -oP 'https://claude\.com.*' /tmp/cc-auth-output.txt 2>/dev/null | head -1)
if [ -n "$URL" ]; then
  echo "===LOGIN_URL==="
  echo "$URL"
  echo "===END_URL==="
  echo ""
  echo "Open the URL above in your browser, authorize, and write the code to /root/capture/auth-code.txt"
else
  cat /tmp/cc-auth-output.txt
  echo "Failed to extract login URL"
  kill $CC_PID 2>/dev/null
  exit 1
fi
