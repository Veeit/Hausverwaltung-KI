# Docker-Image via GitHub Actions → Unraid — Design

**Datum:** 2026-08-30
**Status:** Entwurf genehmigt (Brainstorming mit Veit)
**Bezug:** `docs/superpowers/specs/2026-08-29-ki-hausverwaltung-mvp-design.md`,
`docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md`

## 1. Ziel

Jeder Push auf `main` baut ein Docker-Image der KI-Hausverwaltung in GitHub
Actions und pusht es nach `ghcr.io`. Auf Veits Unraid-Server läuft daraus **ein**
Container, der Dashboard und Worker enthält. Vorbild ist
`~/Dev/GrowGuardServer/.github/workflows/docker.yml`.

## 2. Ausgangslage

- Das Repo enthält bisher **nur** Spec und Implementierungsplan; es gibt keinen
  Anwendungscode.
- Das Repo hat **kein Git-Remote**.
- Der MVP-Stack steht laut Plan fest: Next.js 15 / React 19, Tailwind 4,
  better-sqlite3 (natives Modul) + Drizzle, `@anthropic-ai/sdk`, imapflow,
  nodemailer, Vitest, `tsx` — plus ein **separater Worker-Prozess**, der sich
  mit der Next.js-App dieselbe SQLite-Datei teilt.

## 3. Getroffene Entscheidungen

> **Überholt (2026-08-31):** Repository und Paket wurden entgegen der Zeile
> „Registry" unten **öffentlich** angelegt (`Veeit/Hausverwaltung-KI`,
> `ghcr.io/veeit/hausverwaltung-ki`). Maßgeblich für den Betrieb ist
> `deploy/unraid/README.md`, nicht diese Tabelle.

| Frage | Entscheidung | Begründung |
|---|---|---|
| Prozess-Topologie | **Ein Image, ein Container, beide Prozesse** über einen kleinen Node-Supervisor | Nur ein Unraid-Template, ein Volume, Secrets einmal gepflegt |
| Registry | **Privates GitHub-Repo, privates GHCR-Image** | Geschäftslogik bleibt nicht öffentlich; Unraid meldet sich einmalig mit PAT an |
| Update-Weg | `main` → `:latest`, Aktualisierung per **"Force Update"** in der Unraid-UI | Volle Kontrolle; kein ungefragtes Live-Deployment im laufenden Mailbetrieb |
| Zeitpunkt | **Sofort**, unabhängig vom MVP-Plan | Deployment-Weg früh belastbar; Unraid-Einrichtung einmal durchgespielt |
| Plattform | nur `linux/amd64` | Unraid ist x86_64; arm64 kostete nur QEMU-Zeit für das native Modul |
| Basis-Image | `node:22-bookworm-slim` (nicht Alpine) | `better-sqlite3` kompiliert nativ; glibc erspart musl-Fallstricke |

**Scaffolding statt Wegwerf-Platzhalter:** Damit ein Image überhaupt baubar ist,
wird die App-Grundstruktur jetzt angelegt — aber exakt als die Datei-Menge aus
**Task 1 des MVP-Plans**, nicht als Wegwerf-Attrappe. Task 1 wird anschließend
von „aus dem leeren Verzeichnis" auf „ergänzt das bestehende Scaffolding"
umgeschrieben. Doppelarbeit entfällt.

## 4. Container-Aufbau

### 4.1 Dockerfile (mehrstufig)

| Stage | Inhalt |
|---|---|
| `deps` | `build-essential`, `python3`, `npm ci` (kompiliert better-sqlite3) |
| `build` | Quellcode + `npm run build` → `.next/` |
| `prod-deps` | `npm ci --omit=dev`, natives Modul erneut gebaut |
| `runtime` | slim ohne Compiler: `.next`, `src`, `public`, Prod-`node_modules`, `docker/entrypoint.mjs` |

Alle Stages nutzen dieselbe Basis, damit das kompilierte `better-sqlite3` zur
Runtime-glibc passt.

**Runtime-Eigenschaften:**

- Läuft als **uid 99 / gid 100** (`nobody:users`) — Unraids Besitzer für
  `/mnt/user/appdata`. Ein abweichender uid führt zu Schreibfehlern auf dem
  gemounteten Volume.
- `VOLUME /app/data` als einziger persistenter Pfad. Die App kennt kein
  `DATA_DIR`; das Image setzt stattdessen die im MVP-Plan vereinbarten
  Variablen `DATABASE_PATH=/app/data/hausverwaltung.db` und
  `ATTACHMENTS_DIR=/app/data/attachments`. Hochgeladene Dokumente liegen
  als extrahierter Text in der Datenbank und brauchen keinen eigenen Pfad.
- `EXPOSE 3000`, `ENV NODE_ENV=production PORT=3000 TZ=Europe/Berlin`.
- `HEALTHCHECK` gegen `/api/health` (Route wird mit angelegt: prüft, dass der
  Prozess antwortet und die SQLite-Datei beschreibbar ist).
- `ENTRYPOINT ["node", "docker/entrypoint.mjs"]`.

**Abhängigkeits-Anpassung:** `tsx` wandert von den devDependencies in die
dependencies, damit der Worker aus dem Prod-Image heraus startbar ist.

### 4.2 Supervisor `docker/entrypoint.mjs`

Rund 50 Zeilen Node, bewusst ohne s6/supervisord:

- startet `next start`;
- startet zusätzlich den Worker (`tsx src/worker/index.ts`), **falls die Datei
  existiert** — dadurch funktioniert das Setup schon vor Task 10 des MVP-Plans
  (nur Dashboard) und ab Task 10 automatisch mit beiden Prozessen;
- präfixt beide Ausgabeströme mit `[web]` / `[worker]`, damit das Unraid-Log
  lesbar bleibt;
- beendet beim Tod eines Kindprozesses auch den anderen und verlässt den
  Container mit dessen Exit-Code → Unraids Restart-Policy startet neu;
- leitet `SIGTERM`/`SIGINT` an beide Kinder weiter (sauberes Stoppen aus der
  Unraid-UI), mit Kill-Timeout als Fallback;
- `RUN_WORKER=0` schaltet den Worker ab (z.B. für reine Dashboard-Tests).

## 5. GitHub Actions

Datei: `.github/workflows/docker.yml`

- **Trigger:** Push auf `main`, Pull Requests auf `main`, Tags `v*`,
  `workflow_dispatch`. `concurrency`-Gruppe mit `cancel-in-progress`.
- **Job `test`:** Node 22, `npm ci`, `npm test`, `npm run build`.
- **Job `build-and-push`** (`needs: test`, `permissions: contents:read,
  packages:write`):
  - `docker/setup-buildx-action`
  - `docker/login-action` gegen `ghcr.io` mit `GITHUB_TOKEN`
  - `docker/metadata-action`: Tags `latest` (nur Default-Branch),
    `sha-<kurz>`, SemVer bei `v*`, PR-Tag
  - `docker/build-push-action`: `platforms: linux/amd64`,
    `cache-from/to: type=gha`, `push` nur wenn kein PR
- **Smoke-Test nach dem Build:** Image lokal starten (Dummy-Env, temporäres
  Volume), auf `/api/health` warten, Container wieder abräumen. Ohne diesen
  Schritt fiele ein nicht startender Container erst auf dem Server auf.

**Voraussetzung:** Das Repo muss auf GitHub liegen. Es wird als **privates**
Repo `veeit/KI-Hausverwaltung` angelegt; der erste Push erfolgt erst nach
ausdrücklicher Freigabe durch Veit. Image-Name: `ghcr.io/veeit/ki-hausverwaltung`
(GHCR erzwingt Kleinschreibung).

## 6. Unraid-Betrieb

### 6.1 Einmaliger Registry-Login

`docker login ghcr.io -u veeit` mit einem PAT (Scope `read:packages`).
Unraids Root-Dateisystem liegt im RAM — der Login überlebt keinen Reboot.
Beide Wege werden dokumentiert, die Wahl trifft Veit:

- **Bequem:** User-Script („At First Array Start") oder Eintrag in
  `/boot/config/go`. Der PAT liegt dann im Klartext auf dem Flash-Laufwerk.
- **Sicherer:** nach jedem Reboot manuell einloggen.

### 6.2 Zwei Wege zum Container (beide werden geliefert)

1. `deploy/unraid/docker-compose.yml` für das **Compose-Manager-Plugin** —
   einfügen, starten, fertig.
2. Feldtabelle für **„Add Container"** von Hand: Repository, Port `3080→3000`,
   Pfad `/mnt/user/appdata/ki-hausverwaltung` → `/app/data`, alle
   Env-Variablen.

### 6.3 Konfiguration

Env-Variablen: `ANTHROPIC_API_KEY`, Fastmail-IMAP/SMTP-Zugangsdaten, der
dedizierte Alias, `DASHBOARD_PASSWORD`, `MAIL_RATE_LIMIT_PER_HOUR`,
`POLL_INTERVAL_MS`, `LANDLORD_NAME`, `TZ`. `DATABASE_PATH` und
`ATTACHMENTS_DIR` sind im Image bereits korrekt vorbelegt und müssen in
Unraid nicht gesetzt werden.
Die maßgebliche Liste ist `.env.example`; die Unraid-Doku wird daraus abgeleitet.

### 6.4 Aktualisieren und Zurückrollen

GitHub baut `:latest`; im Unraid-Docker-Tab „Force Update" klicken. Rollback
durch Umstellen des Tags auf einen `sha-`-Tag.

### 6.5 Sicherheitshinweis in der Dokumentation

Der PoC hat als Auth nur ein einzelnes Passwort und verschickt echte E-Mails.
Der Container gehört ins LAN bzw. hinter VPN, **nicht** ans offene Internet.

## 7. Lokale Prüfung

`docker-compose.yml` im Repo-Root zum Bauen und Starten des Images auf dem Mac
vor jedem Push. Hinweis in der Doku: Der lokale Build läuft auf Apple Silicon
unter Emulation langsamer, weil das Image `linux/amd64` ist; für reine
Funktionsprüfungen genügt ein nativer Build ohne `--platform`.

## 8. Zu liefernde Dateien

| Datei | Zweck |
|---|---|
| `Dockerfile` | mehrstufiger Build |
| `.dockerignore` | `.git`, `node_modules`, `.next`, `.env*`, `docs`, Daten |
| `docker/entrypoint.mjs` | Supervisor für beide Prozesse |
| `.github/workflows/docker.yml` | Test → Build → Smoke → Push |
| `docker-compose.yml` | lokaler Test |
| `deploy/unraid/docker-compose.yml` | Compose-Manager-Variante |
| `deploy/unraid/README.md` | Login, Feldtabelle, Update, Rollback, Sicherheit |
| `src/app/api/health/route.ts` | Healthcheck-Endpunkt |
| Scaffolding aus MVP-Task 1 | `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `src/app/{layout,page}.tsx`, `src/app/globals.css` |
| Änderung an `docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md` | Task 1 auf „ergänzt bestehendes Scaffolding" umschreiben |

## 9. Testen

- **CI:** `npm test` (Vitest) im `test`-Job, danach der Container-Smoke-Test
  gegen `/api/health`.
- **Unit:** Test für die `/api/health`-Route.
- **Manuell vor dem ersten Unraid-Deployment:** lokaler `docker compose up`,
  Aufruf des Dashboards, Prüfung, dass die SQLite-Datei im gemounteten Volume
  landet und nach einem Container-Neustart erhalten bleibt.
- Der Supervisor wird nicht unit-getestet; sein Verhalten (ein Prozess stirbt →
  Container endet) wird einmal manuell mit `docker kill` auf den Kindprozess
  geprüft und in der Doku festgehalten.

## 10. Bewusst nicht im Umfang

- Kein Multi-Arch-Build (nur amd64)
- Kein automatisches Update (kein Watchtower)
- Kein Next.js-`standalone`-Output; das Image ist dadurch größer, der Aufbau
  aber deutlich einfacher. Als spätere Optimierung vorgemerkt.
- Kein Reverse-Proxy, kein TLS-Terminierungs-Setup, keine Backup-Automatik für
  `/app/data`
