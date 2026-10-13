# Backend image for hosting the app online (trial server for the shop). Installs on the shop's own
# machine do not use this: they come from packaging/ (see packaging/README.md).
#
# Needs a persistent volume mounted at /data (database, backups, logs) and the variables listed in
# DEPLOY.md, at least QLCN_PUBLIC_URLS. Without a volume every redeploy starts from an empty database.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Compilers for better-sqlite3, in case no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Migrations are plain SQL that tsc does not copy.
RUN npx tsc -p tsconfig.build.json \
  && cp -r src/db/migrations dist/db/migrations \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    QLCN_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# No VOLUME instruction: some platforms (Railway) reject it; the volume is attached in their settings.
CMD ["node", "dist/main.js", "serve"]
