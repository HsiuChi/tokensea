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

# Install Claude Code for live fingerprint capture
RUN bun add -g @anthropic-ai/claude-code || true

# Copy built artifacts from builder
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile || bun install --production

# Environment defaults for TokenSea container mode
ENV DARIO_HOST=0.0.0.0
ENV DARIO_NO_LIVE_CAPTURE=0
ENV DARIO_LISTEN_PORT=3456

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3456/healthz || exit 1

ENTRYPOINT ["bun", "run", "dist/cli.js"]
CMD ["proxy"]
