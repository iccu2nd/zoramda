# Botenv – Railway / Docker compatible
FROM node:20-alpine AS base
WORKDIR /app

# deps stage: need git for some npm transitive deps
FROM base AS deps
RUN apk add --no-cache git python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botenv && \
    apk add --no-cache wget

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=botenv:nodejs package.json ./
COPY --chown=botenv:nodejs src ./src
COPY --chown=botenv:nodejs plugins ./plugins
COPY --chown=botenv:nodejs public ./public

USER botenv
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/index.js"]
