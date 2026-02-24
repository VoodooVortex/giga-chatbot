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
RUN pnpm install --frozen-lockfile

# Production stage
FROM base AS runner

ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker
USER worker

# Start the worker
CMD ["node", "dist/index.js"]