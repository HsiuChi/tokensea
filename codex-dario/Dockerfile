# ── Stage 1: Build the Rust tls-shim ──────────────────────────────
FROM rust:1.85-slim AS rust-builder

WORKDIR /build
COPY tls-shim/ ./

RUN cargo build --release && \
    cp target/release/tls-shim /tls-shim

# ── Stage 2: Build the TypeScript ────────────────────────────────
FROM oven/bun:1 AS ts-builder

WORKDIR /build
COPY package.json tsconfig.json ./
COPY src/ ./src/

RUN bun install && \
    bun run build

# ── Stage 3: Runtime ─────────────────────────────────────────────
FROM oven/bun:1 AS runtime

# Install Codex CLI (for live fingerprint capture)
RUN bun add -g @openai/codex 2>/dev/null || true

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy the Rust tls-shim binary
COPY --from=rust-builder /tls-shim /app/tls-shim
RUN chmod +x /app/tls-shim

# Copy the TypeScript build output
COPY --from=ts-builder /build/dist/ /app/dist/
COPY --from=ts-builder /build/package.json /app/package.json

WORKDIR /app
RUN bun install --production

# Default environment variables
ENV CODEX_DARIO_HOST=0.0.0.0
ENV CODEX_DARIO_LISTEN_PORT=3457
ENV CODEX_DARIO_NO_LIVE_CAPTURE=0

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3457

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3457/healthz || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["proxy"]
