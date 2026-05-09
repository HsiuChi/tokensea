# Stage 0: Build TLS shim (Go + utls)
FROM golang:1.24-alpine AS shim-builder

WORKDIR /build
COPY tls-shim/go.mod ./
RUN go mod download github.com/refraction-networking/utls@v1.7.0 && \
    go mod download golang.org/x/crypto@v0.31.0
COPY tls-shim/main.go ./
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o tls-shim .

# Stage 1: Build dario (Bun + TypeScript)
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

# Install Node.js v24.x — needed for CC live fingerprint capture
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code for live fingerprint capture
RUN bun add -g @anthropic-ai/claude-code || true

# Copy TLS shim binary
COPY --from=shim-builder /build/tls-shim /usr/local/bin/tls-shim

# Copy built artifacts from builder
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile || bun install --production

# Install tshark for fingerprint capture scripts
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tshark iproute2 \
    && rm -rf /var/lib/apt/lists/*

# Copy fingerprint scripts
COPY scripts/ /app/scripts/
RUN chmod +x /app/scripts/*.sh

# Create fingerprint data directory
RUN mkdir -p /app/data/fingerprints

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Environment defaults
ENV DARIO_HOST=0.0.0.0
ENV DARIO_NO_LIVE_CAPTURE=0
ENV DARIO_LISTEN_PORT=3456
ENV DARIO_NO_CC_UPDATE=0
ENV TLS_SHIM_LISTEN_ADDR=127.0.0.1:3443
ENV TLS_SHIM_TARGET_HOST=api.anthropic.com:443
ENV DARIO_TLS_SHIM=1

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3456/healthz || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["proxy"]
