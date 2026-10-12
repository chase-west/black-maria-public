# BLACK MARIA: one image, one process (HTTP + WebSocket on :8787). Build context: the repository root.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# What candidates download from /download (apps/server/src/downloads.ts): the public repository and the two packages.
RUN node scripts/export-public.mjs /tmp/export/blackmaria && mkdir -p /app/downloads \
 && tar czf /app/downloads/blackmaria-public.tar.gz -C /tmp/export blackmaria && rm -rf /tmp/export
RUN pnpm build
RUN node scripts/pack-public.mjs --out /app/downloads
RUN pnpm prune --prod || true

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
COPY deploy/entrypoint.sh /usr/local/bin/blackmaria-entrypoint
RUN chmod +x /usr/local/bin/blackmaria-entrypoint && mkdir -p /data && chown -R node:node /data /app/assets
USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data ASSETS_DIR=/app/assets TRUST_PROXY=1 DOWNLOADS_DIR=/app/downloads
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["blackmaria-entrypoint"]
CMD ["node", "apps/server/dist/main.js"]
