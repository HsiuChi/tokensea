# Stage 1: Build
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN bun install --frozen-lockfile || bun install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun run build

# Stage 2: Runtime
FROM oven/bun:1

WORKDIR /app

# Install Claude Code for live fingerprint capture.
# This provides a base version; the entrypoint script updates it at startup
# to ensure the latest CC shape (tools, system prompt, headers).
RUN bun add -g @anthropic-ai/claude-code || true

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy built artifacts from builder
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile || bun install --production

# Copy entrypoint script (updates CC to latest at startup)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Environment defaults for TokenSea container mode
ENV DARIO_HOST=0.0.0.0
ENV DARIO_NO_LIVE_CAPTURE=0
ENV DARIO_LISTEN_PORT=3456
# Set to 1 to skip CC update at startup (use installed version)
ENV DARIO_NO_CC_UPDATE=0

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3456/healthz || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["proxy"]
