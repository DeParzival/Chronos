# ============================================================
# Chronos — Multi-stage Dockerfile
# ============================================================
# Stage 1: Build — install deps, compile TypeScript
# Stage 2: Production — lean image with only compiled output
# ============================================================

# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S Chronos && \
    adduser -S Chronos -u 1001
USER Chronos

# Expose default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]
