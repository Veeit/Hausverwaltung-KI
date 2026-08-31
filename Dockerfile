# syntax=docker/dockerfile:1

# ============================================================
# Gemeinsame Basis. Alle Stages nutzen dieselbe Distribution,
# damit das nativ kompilierte better-sqlite3 zur Laufzeit-glibc passt.
# ============================================================
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Basis mit Compiler-Werkzeugen (node-gyp fuer better-sqlite3)
FROM base AS toolchain
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# 1. Alle Dependencies (inkl. dev) fuer den Next.js-Build
# ============================================================
FROM toolchain AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ============================================================
# 2. Next.js-Build
# ============================================================
FROM toolchain AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ============================================================
# 3. Nur Produktions-Dependencies (better-sqlite3 erneut gebaut)
# ============================================================
FROM toolchain AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ============================================================
# 4. Laufzeit-Image — ohne Compiler
# ============================================================
FROM base AS runtime

# uid 99 / gid 100 = nobody:users. Unraid legt /mnt/user/appdata mit genau
# diesem Besitzer an; ein anderer Benutzer koennte dort nicht schreiben.
RUN useradd --uid 99 --gid 100 --no-create-home --home-dir /app --shell /usr/sbin/nologin app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin \
    DATABASE_PATH=/app/data/hausverwaltung.db \
    ATTACHMENTS_DIR=/app/data/attachments \
    RUN_WORKER=1

COPY --from=prod-deps /app/node_modules ./node_modules
# tsconfig.json wird zur Laufzeit gebraucht: tsx liest den Pfad-Alias @/* daraus.
COPY package.json package-lock.json tsconfig.json next.config.ts ./
# typescript wird zur Laufzeit gebraucht, obwohl es nur eine devDependency ist:
# next start transpiliert next.config.ts beim Hochfahren und braucht dafuer
# das Paket im node_modules. Aus der deps-Stage kopiert, damit exakt die
# lockfile-gepinnte Version verwendet wird (keine erneute Aufloesung gegen
# die Registry).
COPY --from=deps /app/node_modules/typescript ./node_modules/typescript
COPY --from=build /app/.next ./.next
COPY src ./src
COPY docker ./docker
# Sobald das Projekt statische Dateien unter public/ ablegt, hier ergaenzen:
# COPY public ./public

RUN mkdir -p /app/data/attachments && chown -R 99:100 /app/data
VOLUME ["/app/data"]

USER 99:100
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "docker/entrypoint.mjs"]
