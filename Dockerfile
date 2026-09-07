# Production-ready multi-stage Dockerfile for ZoraBot
FROM node:20-alpine AS base
WORKDIR /app

# Install production deps only
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 zorabot

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=zorabot:nodejs . .

USER zorabot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/index.js"]
