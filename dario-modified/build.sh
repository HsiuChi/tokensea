#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="tokensea-dario"
IMAGE_TAG="latest"

echo "=== Building dario TypeScript ==="
cd "$SCRIPT_DIR"
npm run build

echo "=== Building Docker image ${IMAGE_NAME}:${IMAGE_TAG} ==="
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo "=== Done ==="
echo "Run with: docker run --rm -p 3456:3456 -e DARIO_OAUTH_ACCESS_TOKEN=... -e DARIO_OAUTH_REFRESH_TOKEN=... ${IMAGE_NAME}:${IMAGE_TAG}"
