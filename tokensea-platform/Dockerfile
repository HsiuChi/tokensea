FROM node:22-alpine

WORKDIR /app

# Install all deps (including dev for tsx)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy backend source
COPY tsconfig.json ./
COPY src ./src

# Build frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Back to app root
WORKDIR /app

EXPOSE 3100

# Run with tsx (handles TypeScript natively)
CMD ["npx", "tsx", "src/server.ts"]
