# ============================ Build stage ============================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 нативті компиляциясы үшін құралдар
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .
RUN node tools/build.js

# ============================ Runtime stage ==========================
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# PDF есептеріндегі кириллица үшін қаріптер
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./

RUN mkdir -p server/uploads server/database/data \
    && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
