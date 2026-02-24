# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Install dependencies
RUN apk add --no-cache libc6-compat

# Enable corepack for pnpm
RUN corepack enable pnpm

WORKDIR /app

# Install dependencies stage
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# Production stage
FROM base AS runner

ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Copy dependencies and build output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker
USER worker

# Start the worker
CMD ["node", "dist/index.js"]
