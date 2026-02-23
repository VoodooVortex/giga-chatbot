# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Install dependencies only when needed
RUN apk add --no-cache libc6-compat

# Enable corepack for pnpm support
RUN corepack enable pnpm

WORKDIR /app

# Install dependencies stage
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
# Install all dependencies (including devDependencies) so we can run build or dev
RUN pnpm install --no-frozen-lockfile

# Development image
FROM deps AS dev
COPY . .
CMD ["pnpm", "dev"]

# Rebuild the source code only when needed
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm run build

# Production image, copy all the files and run next
FROM base AS runner

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is created by next build from the standalone output
CMD ["node", "server.js"]
