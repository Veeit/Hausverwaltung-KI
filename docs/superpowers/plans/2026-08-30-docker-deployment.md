# Docker-Deployment via GitHub Actions → Unraid — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Push auf `main` baut in GitHub Actions ein Docker-Image der KI-Hausverwaltung, pusht es privat nach `ghcr.io`, und auf Veits Unraid-Server läuft daraus ein einzelner Container mit Dashboard und Mail-Worker.

**Architecture:** Ein mehrstufiges Dockerfile auf `node:22-bookworm-slim` baut Next.js und installiert separat die Produktions-Dependencies (natives `better-sqlite3`). Im Laufzeit-Image startet ein ~70-zeiliger Node-Supervisor (`docker/entrypoint.mjs`) beide Prozesse, präfixt deren Logs und beendet den Container, sobald einer stirbt. GitHub Actions testet, baut, startet das Image zur Rauchprobe gegen `/api/health` und pusht es erst danach.

**Tech Stack:** Docker (Buildx, BuildKit), GitHub Actions (`docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6`), GitHub Container Registry, Node 22, Next.js 15, Vitest, Unraid (Compose-Manager-Plugin oder „Add Container").

**Spec:** `docs/superpowers/specs/2026-08-30-docker-deployment-design.md`
**Verwandter Plan:** `docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md` — dessen Task 1 wird in Task 1 dieses Plans umgeschrieben.

## Global Constraints

- Registry und Image: **`ghcr.io/veeit/ki-hausverwaltung`**, Paket-Sichtbarkeit **privat**. `docker/metadata-action` schreibt den Namen automatisch klein.
- Build-Plattform: **nur `linux/amd64`**. Unraid ist x86_64; ein arm64-Build kostete nur QEMU-Zeit für das native Modul.
- Basis-Image: **`node:22-bookworm-slim`** (nicht Alpine — `better-sqlite3` kompiliert nativ gegen glibc). Alle Build-Stages nutzen dieselbe Basis, damit das kompilierte Modul zur Laufzeit-glibc passt.
- Laufzeit-User im Container: **uid 99 / gid 100** (`nobody:users`) — Unraids Besitzer für `/mnt/user/appdata`. Ein abweichender uid erzeugt Schreibfehler auf dem gemounteten Volume.
- Persistenz: genau ein Volume, **`/app/data`**. Das Image belegt `DATABASE_PATH=/app/data/hausverwaltung.db` und `ATTACHMENTS_DIR=/app/data/attachments` vor; ein `DATA_DIR` gibt es nicht.
- `tsx` ist eine **Produktions**-Dependency (nicht devDependency), weil der Worker im Prod-Image über `node --import tsx` gestartet wird.
- Node lokal >= 20 (empfohlen 22), npm; TypeScript `strict: true`; ESM (`"type": "module"`); Pfad-Alias `@/*` → `./src/*` identisch in `tsconfig.json` und `vitest.config.ts`.
- Alle Log-Ausgaben des Supervisors und alle Dokumentation auf **Deutsch**; Code-Identifier englisch.
- Kein ESLint (bewusst nicht Teil des PoC).
- Commits: Präfixe `feat:` / `chore:` / `docs:`; jede Commit-Message endet mit einer Leerzeile und `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Host-Port 3100 statt 3000 in allen lokalen Verifikationsschritten:** Auf Veits Mac belegt ein fremder Next.js-Dev-Server Port 3000. Der Port *im* Container bleibt 3000; nur die Host-Seite weicht aus. In der CI (Task 5) bleibt es bei 3000, dort ist der Runner leer.
- Task 6 enthält ein **Freigabe-Gate**: Vor dem Anlegen des GitHub-Repositories und dem ersten Push muss Veit ausdrücklich zustimmen.

## Dateiübersicht

| Datei | Verantwortung | Task |
|---|---|---|
| `.gitignore` | hält Secrets, Daten, Build-Artefakte und Worktrees aus dem Repo | 1 |
| `package.json` | Scripts und Dependencies (inkl. `tsx` als Prod-Dependency) | 1 |
| `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts` | Toolchain-Konfiguration | 1 |
| `.env.example` | maßgebliche Liste aller Umgebungsvariablen | 1 |
| `README.md` | Kurzbeschreibung und Schnellstart | 1 |
| `src/app/{layout.tsx,page.tsx,globals.css}` | Platzhalter-App, damit `next build` etwas zu bauen hat | 1 |
| `src/lib/health.ts` | reine Zustandsprüfung ohne Next-Abhängigkeit — testbar | 2 |
| `src/app/api/health/route.ts` | dünner HTTP-Adapter über `src/lib/health.ts` | 2 |
| `tests/lib/health.test.ts`, `tests/app/health-route.test.ts` | Tests dazu | 2 |
| `docker/entrypoint.mjs` | Supervisor: startet, überwacht und beendet beide Prozesse | 3 |
| `Dockerfile` | mehrstufiger Build | 4 |
| `.dockerignore` | hält Host-`node_modules` und Secrets aus dem Build-Kontext | 4 |
| `docker-compose.yml` | lokales Bauen und Starten des Images auf dem Mac | 4 |
| `.github/workflows/docker.yml` | Test → Build → Rauchprobe → Push | 5 |
| `deploy/unraid/docker-compose.yml` | Variante für das Unraid-Compose-Manager-Plugin | 7 |
| `deploy/unraid/README.md` | Registry-Login, Feldtabelle, Update, Rollback, Sicherheit | 7 |
| `docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md` | dessen Task 1 wird auf das bestehende Scaffolding umgeschrieben | 1 |

---

### Task 1: Projektgerüst und Anpassung des MVP-Plans

**Ziel:** Aus dem Repository, das bisher nur Dokumentation enthält, wird ein lauffähiges Next.js-15-Projekt, dessen `npm run build` grün durchläuft — die Voraussetzung dafür, überhaupt ein Image bauen zu können. Die Dateien entsprechen exakt dem Vertrag aus Task 1 des MVP-Plans (mit **einer** bewussten Abweichung: `tsx` ist Produktions-Dependency). Zum Schluss wird der MVP-Plan so umgeschrieben, dass sein Task 1 dieses Gerüst nicht erneut anlegt.

**Wichtige Hinweise vorab:**

- Alle Kommandos im Wurzelverzeichnis des Arbeitsbaums ausführen.
- `npm install` kann mehrere Minuten dauern: `better-sqlite3` kompiliert ein natives Modul (node-gyp). Auf macOS müssen dafür die Xcode Command Line Tools vorhanden sein; schlägt der native Build fehl, `xcode-select --install` ausführen und den Install wiederholen.

**Files:**

- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `README.md`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Modify: `docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md`

**Interfaces:**

- Consumes: — (erster Task)
- Produces:
  - npm-Scripts, auf die alle Folge-Tasks und das Image sich verlassen: `dev`, `build`, `start`, `worker`, `test`, `test:watch`, `seed`, `smoke`.
  - Pfad-Alias `@/*` → `./src/*`, identisch in `tsconfig.json` (`paths`) und `vitest.config.ts` (`resolve.alias`).
  - `tsx` in `"dependencies"` — vom Supervisor in Task 3 vorausgesetzt.
  - `.env.example` als maßgebliche Variablenliste — von Task 7 für die Unraid-Dokumentation ausgewertet.

- [ ] **Step 1: Node-Version und Repository-Zustand prüfen**

  Run:

  ```bash
  node --version && git log --oneline -3
  ```

  Expected: Node `v20.x` oder höher (empfohlen `v22.x`). `git log` zeigt die vorhandenen Dokumentations-Commits — das Repository ist initialisiert, `git init` ist nicht nötig.

- [ ] **Step 2: `.gitignore` anlegen**

  `data/` (SQLite-Datenbank und Mail-Anhänge) und `.env` (Secrets) dürfen nie ins Repository. `.claude/worktrees/` kommt gegenüber dem MVP-Plan hinzu, weil dieser Arbeitsbaum dort liegt und sonst im Hauptrepository als unversionierte Datei auftauchte. Datei `.gitignore` vollständig anlegen:

  ```
  node_modules/
  .next/
  data/
  .env
  *.tsbuildinfo
  next-env.d.ts
  .DS_Store
  .claude/worktrees/
  ```

- [ ] **Step 3: `package.json` mit den Projekt-Scripts anlegen**

  Die Dependencies kommen in den Steps 4–5 per `npm install` dazu. Datei `package.json` vollständig anlegen:

  ```json
  {
    "name": "ki-hausverwaltung",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "worker": "tsx src/worker/index.ts",
      "test": "vitest run",
      "test:watch": "vitest",
      "seed": "tsx scripts/seed.ts",
      "smoke": "tsx scripts/smoke.ts"
    }
  }
  ```

- [ ] **Step 4: Laufzeit-Dependencies installieren**

  `tsx` steht hier bewusst bei den Laufzeit-Dependencies und **nicht** bei den Dev-Dependencies: Das Laufzeit-Image installiert mit `npm ci --omit=dev`, und der Worker wird dort über `node --import tsx` gestartet. Läge `tsx` bei den Dev-Dependencies, startete der Worker im Container nicht.

  Run:

  ```bash
  npm install "next@^15" "react@^19" "react-dom@^19" @anthropic-ai/sdk "zod@^3.25" drizzle-orm "better-sqlite3@^12" imapflow mailparser nodemailer "pdf-parse@^1.1.1" dotenv tsx
  ```

  Expected: Exit-Code 0, Ausgabe `added … packages`. Warnungen über `deprecated`-Pakete sind unkritisch; ein Fehler beim nativen Build von `better-sqlite3` ist es nicht (dann Xcode Command Line Tools installieren und wiederholen).

  **Warum `pdf-parse@^1.1.1` gepinnt ist:** Ohne Pin installiert npm die 2.x-Linie. Deren `exports`-Map kennt nur `"."`, `"./worker"` und `"./node"` — es gibt kein `lib/`-Verzeichnis mehr, und der in MVP-Task 7 verwendete Import `pdf-parse/lib/pdf-parse.js` wäre nicht auflösbar.

- [ ] **Step 5: Dev-Dependencies installieren**

  Run:

  ```bash
  npm install --save-dev "typescript@^5" @types/node @types/react @types/react-dom @types/better-sqlite3 @types/mailparser @types/nodemailer "vitest@^3" "tailwindcss@^4" "@tailwindcss/postcss@^4"
  ```

  Expected: Exit-Code 0, Ausgabe `added … packages`.

  **Warum `typescript@^5` gepinnt ist:** Ohne Pin installiert npm TypeScript 7.x, das Next.js 15 hart ablehnt — `next build` bricht dann schon beim Laden von `next.config.ts` ab (`TypeError: Cannot read properties of undefined (reading 'fileExists')`). Mit TypeScript 6 scheitert stattdessen der Typecheck an `src/app/layout.tsx`, weil TS 6 Side-Effect-Importe untypisierter Module (`./globals.css`) verbietet.

  **Warum `@types/react` und `@types/react-dom` mitinstalliert werden:** Next 15 führt sie als Pflichtpakete. Fehlen sie, installiert `next build` sie selbst nach und verändert dabei `package.json` und `package-lock.json` — die Änderung wäre nicht committet und ließe den Arbeitsbaum unsauber zurück.

- [ ] **Step 6: `package.json` als Prüf-Referenz kontrollieren**

  Run: `cat package.json`

  Expected — alle folgenden Punkte müssen zutreffen (npm schreibt konkrete Versionen mit Caret, z.B. `"next": "^15.5.4"`; Minor/Patch dürfen neuer sein, die **Major-Versionen MÜSSEN stimmen**):

  - `"private": true` und `"type": "module"` sind gesetzt.
  - `"scripts"` exakt:

    ```json
    {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "worker": "tsx src/worker/index.ts",
      "test": "vitest run",
      "test:watch": "vitest",
      "seed": "tsx scripts/seed.ts",
      "smoke": "tsx scripts/smoke.ts"
    }
    ```

  - `"dependencies"` enthält genau diese 13 Pakete: `next` (^15), `react` (^19), `react-dom` (^19), `@anthropic-ai/sdk`, `zod` (^3.25), `drizzle-orm`, `better-sqlite3` (^12), `imapflow`, `mailparser`, `nodemailer`, `pdf-parse` (**^1**, nicht 2.x), `dotenv`, **`tsx`**.
  - `"devDependencies"` enthält genau diese 10 Pakete: `typescript` (**^5**, nicht 6.x oder 7.x), `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3`, `@types/mailparser`, `@types/nodemailer`, `vitest` (^3), `tailwindcss` (^4), `@tailwindcss/postcss` (^4).
  - `tsx` steht **nicht** in `devDependencies`.

- [ ] **Step 7: Commit**

  ```bash
  git add .gitignore package.json package-lock.json
  git commit -m "chore: npm-Projekt mit Scripts und Dependencies initialisiert" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

- [ ] **Step 8: `tsconfig.json` anlegen**

  Strict-Modus, `moduleResolution: "bundler"`, `jsx: "preserve"`, Next-Plugin und der verbindliche Pfad-Alias `@/*` → `./src/*`. Diese Datei landet auch im Laufzeit-Image, weil `tsx` den Alias daraus liest. Datei `tsconfig.json` vollständig anlegen:

  ```json
  {
    "compilerOptions": {
      "target": "ES2017",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [
        {
          "name": "next"
        }
      ],
      "paths": {
        "@/*": ["./src/*"]
      }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
  }
  ```

- [ ] **Step 9: `next.config.ts` anlegen**

  Bewusst leer (Defaults). Datei `next.config.ts` vollständig anlegen:

  ```ts
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {};

  export default nextConfig;
  ```

- [ ] **Step 10: `postcss.config.mjs` anlegen**

  Datei `postcss.config.mjs` vollständig anlegen:

  ```js
  const config = {
    plugins: ["@tailwindcss/postcss"],
  };

  export default config;
  ```

- [ ] **Step 11: `vitest.config.ts` anlegen**

  Node-Umgebung und derselbe Alias `@` → `./src` wie in `tsconfig.json`. Datei `vitest.config.ts` vollständig anlegen:

  ```ts
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { defineConfig } from "vitest/config";

  const rootDir = path.dirname(fileURLToPath(import.meta.url));

  export default defineConfig({
    test: {
      environment: "node",
    },
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
      },
    },
  });
  ```

- [ ] **Step 12: `.env.example` anlegen**

  Alle Umgebungsvariablen des Projekts; Pflichtfelder bleiben leer, optionale zeigen ihre Defaults. Task 7 leitet die Unraid-Dokumentation aus dieser Datei ab. Datei `.env.example` vollständig anlegen:

  ```
  # Anthropic API-Schluessel (PFLICHT) — von https://console.anthropic.com
  ANTHROPIC_API_KEY=

  # IMAP-Zugang zum Mail-Postfach (Defaults: Fastmail)
  IMAP_HOST=imap.fastmail.com
  IMAP_PORT=993

  # SMTP-Versand (Defaults: Fastmail, Port 465 = implizites TLS)
  SMTP_HOST=smtp.fastmail.com
  SMTP_PORT=465

  # Fastmail-Login (PFLICHT) — die Haupt-E-Mail-Adresse des Kontos
  MAIL_USER=

  # Fastmail-App-Passwort mit IMAP- und SMTP-Berechtigung (PFLICHT)
  MAIL_PASSWORD=

  # Dedizierter Alias der Hausverwaltung (PFLICHT), z.B. hausverwaltung@example.com
  # Nur Mails AN diesen Alias werden verarbeitet; er ist zugleich die Absenderadresse.
  MAIL_ALIAS=

  # Passwort fuer das Vermieter-Dashboard (PFLICHT)
  DASHBOARD_PASSWORD=

  # Kill-Switch: maximale Anzahl ausgehender Mails pro Stunde
  MAIL_RATE_LIMIT_PER_HOUR=20

  # Pfad zur SQLite-Datenbankdatei (im Container: /app/data/hausverwaltung.db)
  DATABASE_PATH=./data/hausverwaltung.db

  # Ablageverzeichnis fuer Mail-Anhaenge (im Container: /app/data/attachments)
  ATTACHMENTS_DIR=./data/attachments

  # IMAP-Polling-Intervall des Workers in Millisekunden
  POLL_INTERVAL_MS=30000

  # Name des Vermieters (erscheint im Systemprompt der KI)
  LANDLORD_NAME=Der Vermieter

  # Worker im Container abschalten (nur fuer Tests): 0 = aus, alles andere = an
  RUN_WORKER=1
  ```

- [ ] **Step 13: `src/app/globals.css` anlegen**

  Datei `src/app/globals.css` vollständig anlegen:

  ```css
  @import "tailwindcss";
  ```

- [ ] **Step 14: `src/app/layout.tsx` anlegen**

  Minimales Root-Layout mit `lang="de"` (wird in MVP-Task 11 durch das Layout mit Navigation ersetzt). Datei `src/app/layout.tsx` vollständig anlegen:

  ```tsx
  import type { Metadata } from "next";
  import type { ReactNode } from "react";
  import "./globals.css";

  export const metadata: Metadata = {
    title: "KI-Hausverwaltung",
    description: "KI-gestützte Hausverwaltung per E-Mail — Proof of Concept",
  };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="de">
        <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
          {children}
        </body>
      </html>
    );
  }
  ```

- [ ] **Step 15: `src/app/page.tsx` anlegen**

  Datei `src/app/page.tsx` vollständig anlegen:

  ```tsx
  export default function HomePage() {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">KI-Hausverwaltung</h1>
        <p className="mt-2 text-gray-600">
          Platzhalter-Startseite — das Projektgerüst steht.
        </p>
      </main>
    );
  }
  ```

- [ ] **Step 16: README-Stub anlegen**

  Datei `README.md` vollständig anlegen:

  ````md
  # KI-Hausverwaltung

  E-Mail-basierte, KI-gestützte Hausverwaltung — Proof of Concept.

  Mieter melden Anliegen per E-Mail an einen dedizierten Alias. Ein KI-Agent
  (Claude Opus 5) führt den Support-Dialog auf Deutsch, sammelt gezielt
  Informationen, bereitet Genehmigungsanträge für den Vermieter vor und
  kontaktiert nach dessen Freigabe per Klick Handwerker per E-Mail. Der
  Vermieter steuert alles über ein Next.js-Dashboard.

  ## Stack

  - Next.js 15 (App Router, `src/`-Layout) + separater Worker-Prozess (IMAP-Polling)
  - SQLite über better-sqlite3 + Drizzle ORM, FTS5-Volltextsuche
  - Anthropic TypeScript SDK, Modell `claude-opus-5`
  - Tailwind CSS 4, Vitest

  ## Schnellstart (lokal)

  ```bash
  npm install
  cp .env.example .env   # Pflichtwerte eintragen (siehe Kommentare in der Datei)
  npm run dev            # Dashboard auf http://localhost:3000
  npm run worker         # E-Mail-Worker, separates Terminal
  npm test               # Unit-Tests
  ```

  ## Betrieb im Container

  Siehe `deploy/unraid/README.md`.
  ````

- [ ] **Step 17: Build ausführen, Erfolg verifizieren**

  Run: `npm run build`

  Expected: Exit-Code 0, Ausgabe enthält „Compiled successfully" und eine Routen-Tabelle mit `/`. Keine Typfehler. Der erste Build erzeugt `next-env.d.ts` und `.next/` (beide gitignored). Ein Hinweis, dass kein ESLint konfiguriert ist, ist unkritisch.

- [ ] **Step 18: Commit**

  ```bash
  git add tsconfig.json next.config.ts postcss.config.mjs vitest.config.ts .env.example README.md src/app
  git commit -m "feat: Next.js-Grundgeruest mit Tailwind, Vitest und Konfiguration" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

- [ ] **Step 19: Task 1 des MVP-Plans umschreiben**

  Der MVP-Plan legt in seinem Task 1 dasselbe Gerüst noch einmal an. Nach diesem Task existiert es bereits, also wird der Kopf von Task 1 ersetzt und die verbleibenden Steps (bisher 19–23, die `src/env.ts` test-first liefern) auf 1–5 umnummeriert. Zusätzlich wird die Zeile in der Task-Übersicht angepasst.

  Das folgende Skript arbeitet mit Textmarken statt Zeilennummern und bricht ab, wenn eine Marke fehlt. Skript ausführen:

```bash
python3 - <<'PY'
import pathlib

p = pathlib.Path("docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md")
s = p.read_text()

TASK1 = "### Task 1: Projekt-Scaffolding"
STEP19 = "- [ ] **Step 19: Fehlschlagenden Test schreiben**"
TASK2 = "### Task 2: DB-Fundament"

for marker in (TASK1, STEP19, TASK2):
    assert marker in s, f"Marke nicht gefunden: {marker}"

NEW_HEAD = """### Task 1: Env-Konfiguration

**Ziel:** Die typisierte Umgebungskonfiguration `getEnv()` test-first liefern.

**Voraussetzung:** Das Projektgeruest (`package.json`, `tsconfig.json`,
`next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`,
`README.md`, Platzhalter unter `src/app/`) wurde bereits im Deployment-Plan
`docs/superpowers/plans/2026-08-30-docker-deployment.md` (Task 1) angelegt und
committet. Es wird hier **nicht** erneut erstellt. Abweichung gegenueber der
urspruenglichen Fassung dieses Tasks: `tsx` ist dort eine **Produktions**-
Dependency, weil der Worker im Docker-Image ueber `node --import tsx` startet.

**Voraussetzung pruefen:** `npm run build` und `npm test` laufen gruen, und
`cat package.json` zeigt `tsx` unter `"dependencies"`. Ist das nicht der Fall,
zuerst Task 1 des Deployment-Plans ausfuehren.

**Files:**

- Create: `src/env.ts`
- Test: `tests/env.test.ts`

**Interfaces:**

- Consumes: Pfad-Alias `@/*` -> `./src/*` aus `tsconfig.json` und
`vitest.config.ts`; die Variablenliste aus `.env.example`.
- Produces:
- `src/env.ts`:
  - `export type Env` = `{ ANTHROPIC_API_KEY: string; IMAP_HOST: string; IMAP_PORT: number; SMTP_HOST: string; SMTP_PORT: number; MAIL_USER: string; MAIL_PASSWORD: string; MAIL_ALIAS: string; DASHBOARD_PASSWORD: string; MAIL_RATE_LIMIT_PER_HOUR: number; DATABASE_PATH: string; ATTACHMENTS_DIR: string; POLL_INTERVAL_MS: number; LANDLORD_NAME: string }`
  - `export function getEnv(): Env` — parst `process.env` bei **jedem** Aufruf neu (lazy, testbar); wirft `ZodError`, wenn Pflichtfelder fehlen oder Werte ungueltig sind. Import in Folge-Tasks: `import { getEnv } from "@/env";`

"""

head_start = s.index(TASK1)
step_start = s.index(STEP19)
task2_start = s.index(TASK2)

region = NEW_HEAD + s[step_start:task2_start]
for old, new in ((19, 1), (20, 2), (21, 3), (22, 4), (23, 5)):
    region = region.replace(f"**Step {old}:", f"**Step {new}:")

s = s[:head_start] + region + s[task2_start:]

OLD_ROW = "| 1 | Projekt-Scaffolding | package.json, Configs, `src/env.ts`, Platzhalter-App |"
NEW_ROW = "| 1 | Env-Konfiguration | `src/env.ts` (Projektgeruest liegt bereits vor) |"
assert OLD_ROW in s, "Uebersichtszeile nicht gefunden"
s = s.replace(OLD_ROW, NEW_ROW)

p.write_text(s)
print("MVP-Plan angepasst")
PY
```

  Expected: Ausgabe `MVP-Plan angepasst`, Exit-Code 0. Bricht das Skript mit `AssertionError` ab, wurde der MVP-Plan zwischenzeitlich verändert — dann die betroffene Marke im Skript an den tatsächlichen Text anpassen.

- [ ] **Step 20: Anpassung verifizieren**

  Run:

  ```bash
  sed -n '/^### Task 1: Env-Konfiguration/,/^### Task 2:/p' docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md | grep -n "^### Task 1\|^- \[ \] \*\*Step\|^| 1 |"
  ```

  Expected: Die Überschrift `### Task 1: Env-Konfiguration` und genau fünf Steps, nummeriert `Step 1` bis `Step 5`. Kein `Step 19` mehr.

  Run zusätzlich:

  ```bash
  grep -c "Projekt-Scaffolding" docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md
  ```

  Expected: `0`.

- [ ] **Step 21: Commit**

  ```bash
  git add docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md
  git commit -m "docs: MVP-Plan Task 1 auf bestehendes Projektgeruest umgestellt" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 2: Health-Endpunkt

**Ziel:** Ein `/api/health`-Endpunkt, der nicht nur „der Prozess lebt" meldet, sondern genau den Fehler erkennt, der auf Unraid am wahrscheinlichsten ist: Das gemountete Datenverzeichnis ist für uid 99 nicht beschreibbar. Docker-HEALTHCHECK und die Rauchprobe in der CI hängen daran.

**Files:**

- Create: `src/lib/health.ts`
- Create: `src/app/api/health/route.ts`
- Test: `tests/lib/health.test.ts`
- Test: `tests/app/health-route.test.ts`

**Interfaces:**

- Consumes: Pfad-Alias `@/*` und `vitest.config.ts` aus Task 1.
- Produces:
  - `src/lib/health.ts`:
    - `export const DEFAULT_DATABASE_PATH = "./data/hausverwaltung.db"`
    - `export type HealthStatus = { status: "ok"; worker: "enabled" | "disabled" } | { status: "error"; error: string }`
    - `export function getHealthStatus(env?: NodeJS.ProcessEnv): HealthStatus`
  - `src/app/api/health/route.ts`: `export function GET(): Response` — 200 bei `status: "ok"`, sonst 503. Von Task 3 (Supervisor-Verifikation), Task 4 (Dockerfile-HEALTHCHECK) und Task 5 (CI-Rauchprobe) vorausgesetzt.

**Warum die Logik in `src/lib/health.ts` liegt und nicht in `route.ts`:** Next 15 prüft die Exporte von `route.ts` typseitig und lehnt unbekannte Exporte ab — eine dort exportierte Hilfsfunktion ließe `next build` fehlschlagen. Die reine Funktion getrennt zu halten macht sie außerdem ohne Next-Laufzeit testbar.

- [ ] **Step 1: Fehlschlagenden Test für die Zustandsprüfung schreiben**

  Der Test deckt ab: (a) beschreibbares Verzeichnis → `ok`, (b) fehlendes Verzeichnis → `error`, (c) `RUN_WORKER=0` → `worker: "disabled"`, (d) ohne `DATABASE_PATH` wird der Default verwendet. Datei `tests/lib/health.test.ts` vollständig anlegen:

  ```ts
  import { mkdtempSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import path from "node:path";
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { DEFAULT_DATABASE_PATH, getHealthStatus } from "@/lib/health";

  describe("getHealthStatus", () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = mkdtempSync(path.join(tmpdir(), "hv-health-"));
    });

    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
    });

    it("meldet ok, wenn das Datenverzeichnis beschreibbar ist", () => {
      const result = getHealthStatus({
        DATABASE_PATH: path.join(dataDir, "hausverwaltung.db"),
      });

      expect(result).toEqual({ status: "ok", worker: "enabled" });
    });

    it("meldet worker: disabled, wenn RUN_WORKER=0 gesetzt ist", () => {
      const result = getHealthStatus({
        DATABASE_PATH: path.join(dataDir, "hausverwaltung.db"),
        RUN_WORKER: "0",
      });

      expect(result).toEqual({ status: "ok", worker: "disabled" });
    });

    it("meldet error, wenn das Datenverzeichnis fehlt", () => {
      const missing = path.join(dataDir, "gibt-es-nicht", "hausverwaltung.db");

      const result = getHealthStatus({ DATABASE_PATH: missing });

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toContain(path.join(dataDir, "gibt-es-nicht"));
      }
    });

    it("faellt ohne DATABASE_PATH auf den Default zurueck", () => {
      const result = getHealthStatus({});

      // Das Default-Verzeichnis ./data existiert im Testlauf nicht.
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toContain(path.dirname(DEFAULT_DATABASE_PATH));
      }
    });
  });
  ```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

  Run: `npx vitest run tests/lib/health.test.ts`

  Expected: FAIL — `Failed to resolve import "@/lib/health"` bzw. „Cannot find module".

- [ ] **Step 3: `src/lib/health.ts` implementieren**

  Datei `src/lib/health.ts` vollständig anlegen:

  ```ts
  import { accessSync, constants } from "node:fs";
  import path from "node:path";

  /** Fallback, wenn DATABASE_PATH nicht gesetzt ist (identisch zu .env.example). */
  export const DEFAULT_DATABASE_PATH = "./data/hausverwaltung.db";

  export type HealthStatus =
    | { status: "ok"; worker: "enabled" | "disabled" }
    | { status: "error"; error: string };

  /**
   * Prüft, ob der Container arbeitsfähig ist. Entscheidend ist das Verzeichnis
   * der SQLite-Datei: Auf Unraid gehört /mnt/user/appdata dem Benutzer 99:100,
   * und ein falscher Container-Benutzer scheitert genau hier.
   */
  export function getHealthStatus(env: NodeJS.ProcessEnv = process.env): HealthStatus {
    const databasePath = env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
    const dataDir = path.dirname(databasePath);

    try {
      accessSync(dataDir, constants.W_OK);
    } catch {
      return {
        status: "error",
        error: `Datenverzeichnis ${dataDir} fehlt oder ist nicht beschreibbar`,
      };
    }

    return { status: "ok", worker: env.RUN_WORKER === "0" ? "disabled" : "enabled" };
  }
  ```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

  Run: `npx vitest run tests/lib/health.test.ts`

  Expected: PASS, 4 Tests grün.

- [ ] **Step 5: Fehlschlagenden Test für die Route schreiben**

  Datei `tests/app/health-route.test.ts` vollständig anlegen:

  ```ts
  import { mkdtempSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import path from "node:path";
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { GET } from "@/app/api/health/route";

  describe("GET /api/health", () => {
    let dataDir: string;
    const originalDatabasePath = process.env.DATABASE_PATH;

    beforeEach(() => {
      dataDir = mkdtempSync(path.join(tmpdir(), "hv-route-"));
    });

    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
      if (originalDatabasePath === undefined) {
        delete process.env.DATABASE_PATH;
      } else {
        process.env.DATABASE_PATH = originalDatabasePath;
      }
    });

    it("antwortet mit 200 und status ok", async () => {
      process.env.DATABASE_PATH = path.join(dataDir, "hausverwaltung.db");

      const response = GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    });

    it("antwortet mit 503, wenn das Datenverzeichnis fehlt", async () => {
      process.env.DATABASE_PATH = path.join(dataDir, "weg", "hausverwaltung.db");

      const response = GET();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ status: "error" });
    });
  });
  ```

- [ ] **Step 6: Test ausführen, Fehlschlag verifizieren**

  Run: `npx vitest run tests/app/health-route.test.ts`

  Expected: FAIL — `Failed to resolve import "@/app/api/health/route"`.

- [ ] **Step 7: Route implementieren**

  `dynamic = "force-dynamic"` verhindert, dass Next die Antwort zur Build-Zeit vorrendert — der Endpunkt muss den Zustand zur Laufzeit melden. Datei `src/app/api/health/route.ts` vollständig anlegen:

  ```ts
  import { getHealthStatus } from "@/lib/health";

  // Nie vorrendern: Der Zustand wird bei jedem Aufruf frisch geprüft.
  export const dynamic = "force-dynamic";

  export function GET(): Response {
    const health = getHealthStatus();
    return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
  }
  ```

- [ ] **Step 8: Tests und Build ausführen, Erfolg verifizieren**

  Run: `npm test && npm run build`

  Expected: `npm test` meldet 6 bestandene Tests in 2 Dateien. `npm run build` endet mit Exit-Code 0; die Routen-Tabelle enthält `/api/health` als dynamische Route (Kennzeichen `ƒ`).

- [ ] **Step 9: Endpunkt im laufenden Server prüfen**

  Run:

  ```bash
  npx next start & SERVER_PID=$!; sleep 5; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health; mkdir -p data; curl -s http://127.0.0.1:3000/api/health; echo; kill $SERVER_PID
  ```

  Expected: Der erste Aufruf liefert `503` (das Verzeichnis `./data` existiert noch nicht), nach `mkdir -p data` liefert der zweite Aufruf `{"status":"ok","worker":"enabled"}`.

- [ ] **Step 10: Commit**

  ```bash
  git add src/lib/health.ts src/app/api/health/route.ts tests/lib/health.test.ts tests/app/health-route.test.ts
  git commit -m "feat: Health-Endpunkt mit Pruefung des Datenverzeichnisses" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 3: Prozess-Supervisor

**Ziel:** Ein Node-Skript, das Next.js-Server und Mail-Worker in einem Container startet, ihre Logs unterscheidbar macht, beim Tod eines Prozesses den anderen sauber beendet und den Container mit dessen Exit-Code verlässt. Es kommt ohne s6 oder supervisord aus und funktioniert bereits, solange es den Worker noch gar nicht gibt.

**Files:**

- Create: `docker/entrypoint.mjs`

**Interfaces:**

- Consumes: `./node_modules/.bin/next` und `tsx` aus den Produktions-Dependencies (Task 1); `/api/health` aus Task 2 für die Verifikation.
- Produces: `docker/entrypoint.mjs` als `ENTRYPOINT` des Images (Task 4). Verhalten, auf das sich Tasks 4, 5 und 7 verlassen:
  - `RUN_WORKER=0` startet nur das Dashboard.
  - Fehlt `src/worker/index.ts`, startet ebenfalls nur das Dashboard (Zustand bis MVP-Task 10).
  - `SIGTERM`/`SIGINT` beenden beide Kindprozesse und danach den Supervisor mit Exit-Code 0.
  - Stirbt ein Kindprozess, endet der Supervisor mit dessen Exit-Code (bzw. 1).

**Warum kein Unit-Test:** Das Skript besteht ausschließlich aus Prozess- und Signalverdrahtung; ein aussagekräftiger Test müsste echte Prozesse starten und wäre damit derselbe manuelle Ablauf wie die Steps 3–6, nur langsamer und flakiger. Die Verifikation erfolgt deshalb hier manuell und in Task 4 zusätzlich im Container.

- [ ] **Step 1: `docker/entrypoint.mjs` anlegen**

  Datei `docker/entrypoint.mjs` vollständig anlegen:

  ```js
  #!/usr/bin/env node
  // Startet Next.js-Server und Mail-Worker in einem einzigen Container.
  // Bewusst minimal: kein s6, kein supervisord, keine Abhaengigkeiten.

  import { spawn } from "node:child_process";
  import { existsSync } from "node:fs";

  const WORKER_ENTRY = "src/worker/index.ts";
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  /** @type {{ name: string, child: import("node:child_process").ChildProcess }[]} */
  const children = [];
  let shuttingDown = false;

  /** Schreibt jede Zeile eines Streams mit vorangestelltem Prozessnamen weiter. */
  function pipeWithPrefix(name, source, target) {
    let rest = "";
    source.setEncoding("utf8");
    source.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) target.write(`[${name}] ${line}\n`);
    });
    source.on("end", () => {
      if (rest) target.write(`[${name}] ${rest}\n`);
      rest = "";
    });
  }

  function hasExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
  }

  function start(name, command, args) {
    console.log(`[supervisor] starte ${name}: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    pipeWithPrefix(name, child.stdout, process.stdout);
    pipeWithPrefix(name, child.stderr, process.stderr);

    child.on("error", (error) => {
      console.error(`[supervisor] ${name} konnte nicht gestartet werden: ${error.message}`);
      shutdown(1);
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[supervisor] ${name} beendet (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      );
      // Ein Prozess allein ist nicht arbeitsfaehig: Container beenden,
      // Docker/Unraid startet ihn gemaess Restart-Policy neu.
      shutdown(typeof code === "number" ? code : 1);
    });

    children.push({ name, child });
  }

  function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const { child } of children) {
      if (!hasExited(child)) child.kill("SIGTERM");
    }

    const kill = setTimeout(() => {
      console.error("[supervisor] Zeitlimit erreicht — erzwinge SIGKILL");
      for (const { child } of children) {
        if (!hasExited(child)) child.kill("SIGKILL");
      }
      process.exit(exitCode);
    }, SHUTDOWN_TIMEOUT_MS);

    const poll = setInterval(() => {
      if (children.every(({ child }) => hasExited(child))) {
        clearInterval(poll);
        clearTimeout(kill);
        process.exit(exitCode);
      }
    }, 100);
  }

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      console.log(`[supervisor] ${signal} empfangen — fahre Prozesse herunter`);
      shutdown(0);
    });
  }

  start("web", "./node_modules/.bin/next", ["start"]);

  if (process.env.RUN_WORKER === "0") {
    console.log("[supervisor] Worker deaktiviert (RUN_WORKER=0)");
  } else if (existsSync(WORKER_ENTRY)) {
    start("worker", process.execPath, ["--import", "tsx", WORKER_ENTRY]);
  } else {
    console.log(`[supervisor] ${WORKER_ENTRY} nicht vorhanden — starte nur das Dashboard`);
  }
  ```

- [ ] **Step 2: Voraussetzungen für die Verifikation herstellen**

  Run:

  ```bash
  npm run build && mkdir -p data
  ```

  Expected: Exit-Code 0. `.next/` ist vorhanden, `./data` existiert (sonst antwortet `/api/health` mit 503).

- [ ] **Step 3: Start ohne Worker prüfen (`RUN_WORKER=0`)**

  Run:

  ```bash
  PORT=3100 RUN_WORKER=0 node docker/entrypoint.mjs > /tmp/hv-sup.log 2>&1 & echo $! > /tmp/hv-sup.pid; sleep 6; curl -s http://127.0.0.1:3100/api/health; echo; cat /tmp/hv-sup.log
  ```

  Expected: `{"status":"ok","worker":"disabled"}`. Das Log enthält `[supervisor] starte web: ./node_modules/.bin/next start`, `[supervisor] Worker deaktiviert (RUN_WORKER=0)` und mindestens eine mit `[web]` präfixierte Zeile (z.B. `▲ Next.js`).

- [ ] **Step 4: Sauberes Herunterfahren per SIGTERM prüfen**

  Run:

  ```bash
  kill -TERM "$(cat /tmp/hv-sup.pid)"; sleep 3; tail -3 /tmp/hv-sup.log; ps -p "$(cat /tmp/hv-sup.pid)" > /dev/null 2>&1 && echo "LAEUFT NOCH" || echo "BEENDET"
  ```

  Expected: Das Log endet mit `[supervisor] SIGTERM empfangen — fahre Prozesse herunter` und einer `[supervisor] web beendet …`-Zeile; die letzte Ausgabe ist `BEENDET`.

- [ ] **Step 5: Meldung bei fehlendem Worker prüfen**

  Run:

  ```bash
  PORT=3100 node docker/entrypoint.mjs > /tmp/hv-sup2.log 2>&1 & echo $! > /tmp/hv-sup2.pid; sleep 6; grep "nicht vorhanden" /tmp/hv-sup2.log
  ```

  Expected: Zeile `[supervisor] src/worker/index.ts nicht vorhanden — starte nur das Dashboard`. (Ab MVP-Task 10 existiert die Datei, und stattdessen erscheint `[supervisor] starte worker: …`.)

- [ ] **Step 6: Tod eines Kindprozesses beendet den Supervisor**

  Der Kindprozess wird gezielt über `pgrep -P` (Kinder des Supervisors) beendet.
  **Kein `pkill -f next`** verwenden: Auf diesem Rechner läuft ein fremder
  Next.js-Dev-Server, den ein Musterabgleich mit erwischen würde.

  Run:

  ```bash
  kill "$(pgrep -P "$(cat /tmp/hv-sup2.pid)" | head -1)"; sleep 3; tail -3 /tmp/hv-sup2.log; ps -p "$(cat /tmp/hv-sup2.pid)" > /dev/null 2>&1 && echo "LAEUFT NOCH" || echo "BEENDET"
  ```

  Expected: Das Log enthält eine `[supervisor] web beendet (…)`-Zeile, die letzte Ausgabe ist `BEENDET`. Damit ist belegt: Stirbt ein Prozess, endet der Container — Unraid startet ihn neu.

  Aufräumen:

  ```bash
  rm -f /tmp/hv-sup.log /tmp/hv-sup.pid /tmp/hv-sup2.log /tmp/hv-sup2.pid
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add docker/entrypoint.mjs
  git commit -m "feat: Supervisor startet Dashboard und Worker in einem Container" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 4: Dockerfile und lokaler Build

**Ziel:** Ein Image, das lokal gebaut, gestartet und verifiziert werden kann — inklusive der beiden Eigenschaften, die auf Unraid entscheiden, ob es funktioniert: Der Prozess läuft als uid 99 / gid 100, und `/app/data` ist beschreibbar und überlebt einen Neustart.

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

**Interfaces:**

- Consumes: `package.json`/`package-lock.json` und `tsconfig.json` (Task 1), `/api/health` (Task 2), `docker/entrypoint.mjs` (Task 3).
- Produces: ein Image mit `ENTRYPOINT ["node", "docker/entrypoint.mjs"]`, `EXPOSE 3000`, `VOLUME /app/data` und den vorbelegten Variablen `DATABASE_PATH`, `ATTACHMENTS_DIR`, `RUN_WORKER`, `TZ`, `PORT`. Task 5 baut dasselbe Dockerfile in der CI, Task 7 dokumentiert dessen Schnittstelle für Unraid.

**Voraussetzung:** Docker Desktop läuft. Prüfen mit `docker info` (Exit-Code 0).

- [ ] **Step 1: `.dockerignore` anlegen**

  Ohne diese Datei landen die auf dem Mac für arm64 kompilierten `node_modules` im Build-Kontext und überschreiben im Image die Linux-Variante von `better-sqlite3`. Datei `.dockerignore` vollständig anlegen:

  ```
  .git
  .github
  .claude
  node_modules
  .next
  data
  docs
  deploy
  .env
  .env.*
  *.log
  *.tsbuildinfo
  next-env.d.ts
  .DS_Store
  ```

- [ ] **Step 2: `Dockerfile` anlegen**

  Datei `Dockerfile` vollständig anlegen:

  ```dockerfile
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
  COPY --from=build /app/.next ./.next
  # tsconfig.json wird zur Laufzeit gebraucht: tsx liest den Pfad-Alias @/* daraus.
  COPY package.json package-lock.json tsconfig.json next.config.ts ./
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
  ```

- [ ] **Step 3: `docker-compose.yml` für den lokalen Test anlegen**

  Bewusst ein benanntes Volume statt eines Bind-Mounts: Auf macOS führt ein Bind-Mount mit dem Container-Benutzer 99:100 leicht zu Rechteproblemen, die es auf Unraid gar nicht gibt. Datei `docker-compose.yml` vollständig anlegen:

  ```yaml
  # Lokales Bauen und Starten des Images auf dem Entwicklungsrechner.
  # Fuer den Betrieb auf Unraid siehe deploy/unraid/docker-compose.yml.
  services:
    app:
      build:
        context: .
      image: ki-hausverwaltung:local
      ports:
        # Host-Port ueber HV_PORT ueberschreibbar, Standard 3000.
        - "${HV_PORT:-3000}:3000"
      environment:
        # Ohne echte Zugangsdaten laeuft nur das Dashboard.
        RUN_WORKER: "0"
      volumes:
        - hv-data:/app/data
      restart: unless-stopped

  volumes:
    hv-data:
  ```

- [ ] **Step 4: Image bauen**

  Run:

  ```bash
  docker build -t ki-hausverwaltung:local .
  ```

  Expected: Exit-Code 0, letzte Zeile `naming to docker.io/library/ki-hausverwaltung:local`. Der erste Build dauert einige Minuten (zwei `npm ci`-Läufe mit nativem Modul).

  Der Build läuft hier für die Architektur des Macs (arm64); die CI baut `linux/amd64`. Das ist beabsichtigt — lokal wird die Funktion geprüft, nicht das Zielartefakt.

  Falls der Build in der `runtime`-Stage mit `useradd: UID 99 is not unique` abbricht, ist uid 99 im Basis-Image bereits vergeben; dann `--uid 99` durch `--non-unique --uid 99` ersetzen.

- [ ] **Step 5: Container starten und Health prüfen**

  Run:

  ```bash
  docker run -d --name hv-test -p 3100:3000 -e RUN_WORKER=0 ki-hausverwaltung:local
  sleep 12
  curl -s http://127.0.0.1:3100/api/health; echo
  ```

  Expected: `{"status":"ok","worker":"disabled"}`.

  Falls der Container sofort endet, Log ansehen: `docker logs hv-test`. Bricht `next start` beim Laden von `next.config.ts` ab, fehlt im Laufzeit-Image das Paket `typescript` — dann in der `runtime`-Stage nach dem `COPY --from=prod-deps` die Zeile `RUN npm install --no-save typescript@^5` ergänzen und erneut bauen.

- [ ] **Step 6: Laufzeit-Benutzer und Schreibrechte prüfen**

  Run:

  ```bash
  docker exec hv-test id
  docker exec hv-test sh -c 'touch /app/data/schreibtest && ls -ln /app/data'
  ```

  Expected: `id` gibt `uid=99 gid=100 groups=100(users)` aus. Der zweite Befehl endet mit Exit-Code 0, und die Auflistung zeigt `schreibtest` sowie das Verzeichnis `attachments`, beide mit Besitzer `99 100`.

- [ ] **Step 7: Logs des Supervisors prüfen**

  Run: `docker logs hv-test`

  Expected: Enthält `[supervisor] starte web: ./node_modules/.bin/next start`, `[supervisor] Worker deaktiviert (RUN_WORKER=0)` und mit `[web]` präfixierte Next.js-Ausgaben.

- [ ] **Step 8: Sauberes Stoppen prüfen**

  Run:

  ```bash
  time docker stop hv-test && docker logs hv-test | tail -3
  ```

  Expected: `docker stop` kehrt in weniger als 10 Sekunden zurück (nicht erst nach dem 10-Sekunden-Standard-Timeout von Docker). Das Log endet mit `[supervisor] SIGTERM empfangen — fahre Prozesse herunter`.

- [ ] **Step 9: Aufräumen und Persistenz über Compose prüfen**

  Run:

  ```bash
  docker rm -f hv-test
  HV_PORT=3100 docker compose up -d
  sleep 12
  docker compose exec -T app sh -c 'echo bleibt > /app/data/persistenz.txt'
  HV_PORT=3100 docker compose restart
  sleep 12
  docker compose exec -T app cat /app/data/persistenz.txt
  ```

  Expected: Die letzte Ausgabe ist `bleibt` — das Volume überlebt den Neustart.

- [ ] **Step 10: Fehlerfall des Health-Endpunkts im Container prüfen**

  Run:

  ```bash
  docker compose down
  docker run -d --name hv-broken -p 3100:3000 -e RUN_WORKER=0 -e DATABASE_PATH=/app/gibt-es-nicht/db.sqlite ki-hausverwaltung:local
  sleep 12
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health
  docker rm -f hv-broken
  ```

  Expected: `503`. Damit ist belegt, dass der HEALTHCHECK ein nicht beschreibbares Datenverzeichnis tatsächlich meldet, statt blind „gesund" zu sagen.

- [ ] **Step 11: Commit**

  ```bash
  git add Dockerfile .dockerignore docker-compose.yml
  git commit -m "feat: mehrstufiges Dockerfile mit Supervisor und Health-Check" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 5: GitHub-Actions-Workflow

**Ziel:** Ein Workflow, der bei jedem Push auf `main` testet, das Image für `linux/amd64` baut, es startet und gegen `/api/health` prüft — und es erst danach nach `ghcr.io` pusht. Bei Pull Requests wird gebaut und geprüft, aber nicht gepusht.

**Files:**

- Create: `.github/workflows/docker.yml`

**Interfaces:**

- Consumes: `Dockerfile` und `.dockerignore` (Task 4), `npm test` und `npm run build` (Tasks 1–2), `/api/health` (Task 2), `RUN_WORKER=0` (Task 3).
- Produces: Image-Tags `latest` (nur `main`), `sha-<kurz>`, `pr-<nummer>` sowie SemVer-Tags bei Git-Tags `v*`. Task 7 verweist auf `ghcr.io/veeit/ki-hausverwaltung:latest`.

**Warum zweimal gebaut wird:** Der erste `build-push-action`-Aufruf lädt das Image mit `load: true` in den lokalen Docker-Daemon des Runners, damit die Rauchprobe es starten kann. Der zweite Aufruf pusht — er trifft dank `type=gha`-Cache auf fertige Layer und dauert nur Sekunden. So wird nie ein Image veröffentlicht, das nicht mindestens einmal gestartet ist.

- [ ] **Step 1: Workflow-Datei anlegen**

  Datei `.github/workflows/docker.yml` vollständig anlegen:

  ```yaml
  name: Build and Push Docker Image

  on:
    push:
      branches: [main]
      tags: ["v*"]
    pull_request:
      branches: [main]
    workflow_dispatch:

  concurrency:
    group: docker-${{ github.ref }}
    cancel-in-progress: true

  env:
    REGISTRY: ghcr.io
    # metadata-action schreibt den Repository-Namen automatisch klein.
    IMAGE_NAME: ${{ github.repository }}

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - name: Checkout repository
          uses: actions/checkout@v4

        - name: Set up Node
          uses: actions/setup-node@v4
          with:
            node-version: "22"
            cache: npm

        - name: Install dependencies
          run: npm ci

        - name: Run tests
          run: npm test

        - name: Build Next.js app
          run: npm run build

    build-and-push:
      needs: test
      runs-on: ubuntu-latest
      permissions:
        contents: read
        packages: write

      steps:
        - name: Checkout repository
          uses: actions/checkout@v4

        - name: Set up Docker Buildx
          uses: docker/setup-buildx-action@v3

        - name: Log in to Container Registry
          if: github.event_name != 'pull_request'
          uses: docker/login-action@v3
          with:
            registry: ${{ env.REGISTRY }}
            username: ${{ github.actor }}
            password: ${{ secrets.GITHUB_TOKEN }}

        - name: Extract metadata (tags, labels)
          id: meta
          uses: docker/metadata-action@v5
          with:
            images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
            tags: |
              type=raw,value=latest,enable={{is_default_branch}}
              type=ref,event=pr
              type=semver,pattern={{version}}
              type=semver,pattern={{major}}.{{minor}}
              type=sha,prefix=sha-

        - name: Build image for smoke test
          uses: docker/build-push-action@v6
          with:
            context: .
            platforms: linux/amd64
            load: true
            tags: ki-hausverwaltung:smoke
            cache-from: type=gha
            cache-to: type=gha,mode=max

        - name: Smoke test the image
          run: |
            set -euo pipefail
            docker run -d --name smoke -p 3000:3000 -e RUN_WORKER=0 ki-hausverwaltung:smoke
            for _ in $(seq 1 30); do
              if curl -fsS http://127.0.0.1:3000/api/health; then
                echo
                echo "Health-Endpunkt erreichbar"
                exit 0
              fi
              sleep 2
            done
            echo "Health-Endpunkt antwortete nicht innerhalb von 60 Sekunden"
            exit 1

        - name: Show container logs
          if: always()
          run: docker logs smoke || true

        - name: Remove smoke container
          if: always()
          run: docker rm -f smoke || true

        - name: Build and push Docker image
          uses: docker/build-push-action@v6
          with:
            context: .
            platforms: linux/amd64
            push: ${{ github.event_name != 'pull_request' }}
            tags: ${{ steps.meta.outputs.tags }}
            labels: ${{ steps.meta.outputs.labels }}
            cache-from: type=gha
            cache-to: type=gha,mode=max
  ```

- [ ] **Step 2: YAML-Syntax prüfen**

  Run:

  ```bash
  npx --yes js-yaml .github/workflows/docker.yml > /dev/null && echo "YAML ok"
  ```

  Expected: `YAML ok`. Bei einem Syntaxfehler nennt `js-yaml` Zeile und Spalte.

- [ ] **Step 3: Die Rauchprobe lokal nachstellen**

  Der Workflow lässt sich vor dem Push nicht ausführen, das darin verwendete Kommando aber sehr wohl. Run:

  ```bash
  docker run -d --name smoke -p 3100:3000 -e RUN_WORKER=0 ki-hausverwaltung:local
  for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:3100/api/health && break; sleep 2; done; echo
  docker rm -f smoke
  ```

  Expected: `{"status":"ok","worker":"disabled"}` innerhalb weniger Sekunden, danach entfernt `docker rm -f` den Container.

- [ ] **Step 4: Commit**

  ```bash
  git add .github/workflows/docker.yml
  git commit -m "feat: GitHub-Actions-Workflow baut, prueft und pusht das Image" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  ```

---

### Task 6: GitHub-Repository anlegen und Pipeline scharf schalten

**Ziel:** Der Code liegt in einem privaten GitHub-Repository, der Workflow läuft nachweislich grün, und `ghcr.io/veeit/ki-hausverwaltung:latest` existiert als privates Paket.

**Files:** keine (ausschließlich Git- und GitHub-Operationen)

**Interfaces:**

- Consumes: alle Dateien aus den Tasks 1–5.
- Produces: das Remote `origin`, den Branch `main` auf GitHub und das Paket `ki-hausverwaltung` unter Veits GHCR-Namensraum — Voraussetzung für Task 7.

> **FREIGABE-GATE:** Dieser Task legt eine nach außen wirkende Ressource an und veröffentlicht Code. Vor Step 3 **anhalten** und Veits ausdrückliche Zustimmung einholen. Ohne dieses „ja" wird nichts erstellt und nichts gepusht.

- [ ] **Step 1: `gh`-CLI und Anmeldung prüfen**

  Run:

  ```bash
  gh --version && gh auth status
  ```

  Expected: Versionsausgabe und `Logged in to github.com account veeit`. Fehlt `gh`, installieren mit `brew install gh`; fehlt die Anmeldung, `gh auth login` ausführen (dabei den Scope `write:packages` mitgeben).

- [ ] **Step 2: Arbeitsbaum-Zustand prüfen**

  Run:

  ```bash
  git status --short && git log --oneline -8
  ```

  Expected: Keine unversionierten oder geänderten Dateien. Die Commits der Tasks 1–5 sind vorhanden.

- [ ] **Step 3: Freigabe einholen**

  Veit die folgenden Punkte bestätigen lassen, bevor irgendein Kommando läuft:

  - Repository-Name `veeit/KI-Hausverwaltung`, Sichtbarkeit **privat**
  - Der bisherige Inhalt (Spec, Pläne, Projektgerüst) wird nach GitHub hochgeladen
  - Das gebaute Image wird als **privates** Paket unter `ghcr.io/veeit/ki-hausverwaltung` veröffentlicht

  Ohne ausdrückliche Zustimmung hier abbrechen.

- [ ] **Step 4: Privates Repository anlegen und `main` pushen**

  Run:

  ```bash
  gh repo create veeit/KI-Hausverwaltung --private --source=. --remote=origin
  git push -u origin main
  ```

  Expected: `gh` meldet die erstellte Repository-URL; `git push` überträgt den Branch `main`. Der Workflow läuft dabei noch nicht, weil `.github/workflows/docker.yml` auf dem Feature-Branch liegt.

- [ ] **Step 5: Feature-Branch pushen und Pull Request öffnen**

  Run:

  ```bash
  git push -u origin HEAD
  gh pr create --fill --base main
  ```

  Expected: `gh` gibt die URL des Pull Requests aus.

- [ ] **Step 6: Workflow-Lauf des Pull Requests beobachten**

  Run:

  ```bash
  gh run watch --exit-status
  ```

  Expected: Beide Jobs (`test`, `build-and-push`) enden grün. Im Log von `build-and-push` steht `Health-Endpunkt erreichbar`. Der Schritt „Build and push Docker image" läuft mit `push: false` — bei einem Pull Request wird bewusst **nicht** veröffentlicht.

- [ ] **Step 7: Pull Request mergen**

  Run:

  ```bash
  gh pr merge --squash --delete-branch
  ```

  Expected: Der Pull Request wird gemergt; `main` enthält nun den Workflow.

- [ ] **Step 8: Den Lauf auf `main` beobachten**

  Run:

  ```bash
  git checkout main && git pull && gh run watch --exit-status
  ```

  Expected: Beide Jobs grün. Der letzte Schritt pusht die Tags `latest` und `sha-<kurz>`.

- [ ] **Step 9: Veröffentlichtes Paket prüfen**

  Run:

  ```bash
  gh api "/user/packages/container/ki-hausverwaltung" --jq '.name, .visibility'
  gh api "/user/packages/container/ki-hausverwaltung/versions" --jq '.[0].metadata.container.tags'
  ```

  Expected: Ausgabe `ki-hausverwaltung`, `private` und eine Tag-Liste, die `latest` enthält.

- [ ] **Step 10: Image lokal ziehen**

  Run:

  ```bash
  docker pull --platform linux/amd64 ghcr.io/veeit/ki-hausverwaltung:latest
  ```

  Expected: Der Pull gelingt (die lokale Docker-Anmeldung übernimmt `gh auth`s Token nicht automatisch — schlägt der Pull mit `denied` fehl, vorher `gh auth token | docker login ghcr.io -u veeit --password-stdin` ausführen). Damit ist bewiesen, dass genau der Weg funktioniert, den Unraid in Task 7 geht.

---

### Task 7: Unraid-Deployment

**Ziel:** Veit kann den Container auf Unraid einrichten, aktualisieren und im Notfall zurückrollen, ohne diesen Plan zu lesen — mit einer Compose-Datei zum Einfügen und einer Feldtabelle für den Weg über „Add Container".

**Files:**

- Create: `deploy/unraid/docker-compose.yml`
- Create: `deploy/unraid/README.md`
- Modify: `README.md` (Verweis ergänzen — bereits in Task 1 Step 16 angelegt)

**Interfaces:**

- Consumes: das Image aus Task 6, die Variablenliste aus `.env.example` (Task 1), die Container-Schnittstelle aus Task 4 (Port 3000, Volume `/app/data`, uid 99:100).
- Produces: Betriebsdokumentation. Kein Code, auf den spätere Tasks aufbauen.

- [ ] **Step 1: `deploy/unraid/docker-compose.yml` anlegen**

  Datei `deploy/unraid/docker-compose.yml` vollständig anlegen:

  ```yaml
  # Fuer das Unraid-Plugin "Compose Manager": neuen Stack anlegen und diesen
  # Inhalt einfuegen. Die Platzhalter in Grossbuchstaben vorher ersetzen.
  services:
    ki-hausverwaltung:
      image: ghcr.io/veeit/ki-hausverwaltung:latest
      container_name: ki-hausverwaltung
      restart: unless-stopped
      ports:
        # Host-Port 3080 -> Container-Port 3000
        - "3080:3000"
      volumes:
        - /mnt/user/appdata/ki-hausverwaltung:/app/data
      environment:
        TZ: Europe/Berlin

        # --- Pflichtwerte ---
        ANTHROPIC_API_KEY: SK-ANT-HIER-EINTRAGEN
        MAIL_USER: konto@example.com
        MAIL_PASSWORD: FASTMAIL-APP-PASSWORT
        MAIL_ALIAS: hausverwaltung@example.com
        DASHBOARD_PASSWORD: DASHBOARD-PASSWORT

        # --- Optional, hier mit den Standardwerten ---
        IMAP_HOST: imap.fastmail.com
        IMAP_PORT: "993"
        SMTP_HOST: smtp.fastmail.com
        SMTP_PORT: "465"
        MAIL_RATE_LIMIT_PER_HOUR: "20"
        POLL_INTERVAL_MS: "30000"
        LANDLORD_NAME: Der Vermieter

        # Auf "0" setzen, um den Mail-Worker abzuschalten (nur Dashboard).
        RUN_WORKER: "1"

      # DATABASE_PATH und ATTACHMENTS_DIR sind im Image bereits auf
      # /app/data/... gesetzt und duerfen hier nicht ueberschrieben werden.
  ```

- [ ] **Step 2: Compose-Datei validieren**

  Run:

  ```bash
  docker compose -f deploy/unraid/docker-compose.yml config > /dev/null && echo "Compose ok"
  ```

  Expected: `Compose ok`.

- [ ] **Step 3: `deploy/unraid/README.md` anlegen**

  Datei `deploy/unraid/README.md` vollständig anlegen:

  ````md
  # KI-Hausverwaltung auf Unraid betreiben

  Das Image wird von GitHub Actions gebaut und liegt **privat** unter
  `ghcr.io/veeit/ki-hausverwaltung`. Es enthält Dashboard und Mail-Worker in
  einem Container.

  | Eigenschaft | Wert |
  |---|---|
  | Image | `ghcr.io/veeit/ki-hausverwaltung:latest` |
  | Architektur | `linux/amd64` |
  | Port im Container | `3000` |
  | Persistenter Pfad | `/app/data` (SQLite-Datenbank und Mail-Anhänge) |
  | Prozessbenutzer | uid `99`, gid `100` (`nobody:users`) |
  | Health-Endpunkt | `GET /api/health` |

  ## 1. Einmalig: Anmeldung an der Registry

  Das Paket ist privat, Unraid muss sich also anmelden. Dafür wird ein
  GitHub-Token mit dem Berechtigungsumfang `read:packages` benötigt
  (GitHub → Settings → Developer settings → Personal access tokens).

  Im Unraid-Terminal:

  ```bash
  docker login ghcr.io -u veeit
  ```

  Als Passwort das Token einfügen.

  **Wichtig:** Unraids Betriebssystem läuft im Arbeitsspeicher — diese Anmeldung
  überlebt keinen Neustart des Servers. Es gibt zwei Wege damit umzugehen:

  - **Bequem:** Das Plugin „User Scripts" installieren, ein Skript mit dem
    obigen Befehl in der nicht-interaktiven Form anlegen und auf „At First Array
    Start" stellen:

    ```bash
    echo "GITHUB_TOKEN" | docker login ghcr.io -u veeit --password-stdin
    ```

    Nachteil: Das Token liegt im Klartext auf dem USB-Stick des Servers. Es hat
    nur Lesezugriff auf Pakete — der Schaden bei Verlust ist begrenzt, aber
    vorhanden.

  - **Sicherer:** Nach jedem Neustart des Servers einmal von Hand anmelden.
    Solange der Container läuft, ist keine Anmeldung nötig; sie wird nur zum
    Ziehen einer neuen Version gebraucht.

  ## 2. Container einrichten — Variante A: Compose Manager

  Das Plugin „Compose Manager" installieren, einen neuen Stack anlegen und den
  Inhalt von `docker-compose.yml` aus diesem Verzeichnis einfügen. Danach die
  Pflichtwerte ersetzen und den Stack starten.

  ## 3. Container einrichten — Variante B: „Add Container"

  Docker-Tab → „Add Container" → Vorlage leer lassen und folgende Felder setzen:

  | Feld | Wert |
  |---|---|
  | Name | `ki-hausverwaltung` |
  | Repository | `ghcr.io/veeit/ki-hausverwaltung:latest` |
  | Network Type | `Bridge` |
  | Port (Host → Container) | `3080` → `3000`, TCP |
  | Path (Host → Container) | `/mnt/user/appdata/ki-hausverwaltung` → `/app/data`, Read/Write |

  Dazu diese Variablen (Typ „Variable"):

  | Variable | Pflicht | Wert / Standard |
  |---|---|---|
  | `ANTHROPIC_API_KEY` | ja | Schlüssel aus der Anthropic-Console |
  | `MAIL_USER` | ja | Haupt-E-Mail-Adresse des Fastmail-Kontos |
  | `MAIL_PASSWORD` | ja | Fastmail-App-Passwort (IMAP + SMTP) |
  | `MAIL_ALIAS` | ja | dedizierter Alias, z.B. `hausverwaltung@example.com` |
  | `DASHBOARD_PASSWORD` | ja | Passwort für das Vermieter-Dashboard |
  | `TZ` | nein | `Europe/Berlin` |
  | `IMAP_HOST` | nein | `imap.fastmail.com` |
  | `IMAP_PORT` | nein | `993` |
  | `SMTP_HOST` | nein | `smtp.fastmail.com` |
  | `SMTP_PORT` | nein | `465` |
  | `MAIL_RATE_LIMIT_PER_HOUR` | nein | `20` |
  | `POLL_INTERVAL_MS` | nein | `30000` |
  | `LANDLORD_NAME` | nein | `Der Vermieter` |
  | `RUN_WORKER` | nein | `1` (auf `0` setzen, um nur das Dashboard zu starten) |

  `DATABASE_PATH` und `ATTACHMENTS_DIR` sind im Image bereits korrekt gesetzt
  und dürfen **nicht** überschrieben werden.

  ## 4. Prüfen, ob es läuft

  ```bash
  curl -s http://UNRAID-IP:3080/api/health
  ```

  Erwartet: `{"status":"ok","worker":"enabled"}`.

  Antwortet der Endpunkt mit `{"status":"error", …}`, ist
  `/mnt/user/appdata/ki-hausverwaltung` für den Benutzer 99:100 nicht
  beschreibbar. Korrigieren mit:

  ```bash
  chown -R 99:100 /mnt/user/appdata/ki-hausverwaltung
  ```

  Im Container-Log stehen beide Prozesse mit Präfix: `[web]` für das Dashboard,
  `[worker]` für den Mail-Worker, `[supervisor]` für Start und Stopp.

  Stirbt einer der beiden Prozesse, beendet der Supervisor absichtlich auch den
  anderen und der Container endet — die Restart-Policy `unless-stopped` startet
  ihn dann neu. Ein Container, der sich wiederholt neu startet, hat also ein
  Problem in einem der beiden Prozesse; die Ursache steht im Log oberhalb der
  `[supervisor] … beendet`-Zeile.

  ## 5. Aktualisieren

  Jeder Push auf `main` baut ein neues `:latest`. Auf Unraid im Docker-Tab beim
  Container auf „Force Update" klicken — oder im Compose Manager „Update Stack".
  Es passiert nichts automatisch: Eine neue Version wird erst aktiv, wenn sie
  angefordert wird.

  ## 6. Zurückrollen

  Jeder Build veröffentlicht zusätzlich einen Tag `sha-<kurz>`. Zum Zurückrollen
  im Repository-Feld des Containers `:latest` durch den gewünschten
  `sha-…`-Tag ersetzen und den Container neu anlegen lassen. Die verfügbaren
  Tags stehen auf GitHub unter „Packages".

  ## 7. Sicherheit

  Der Proof of Concept schützt das Dashboard mit einem einzigen Passwort und
  verschickt echte E-Mails an Mieter und Handwerker. Der Container gehört ins
  LAN oder hinter ein VPN — **nicht** über eine Portfreigabe ins offene
  Internet.

  Der Ordner `/mnt/user/appdata/ki-hausverwaltung` enthält die gesamte
  Kommunikation samt Anhängen. Er gehört in die Backup-Auswahl des Servers.
  ````

- [ ] **Step 4: Verweis im Haupt-README prüfen**

  Run:

  ```bash
  grep -n "deploy/unraid/README.md" README.md
  ```

  Expected: Eine Trefferzeile aus dem Abschnitt „Betrieb im Container". Fehlt sie, folgenden Abschnitt an `README.md` anhängen:

  ```md
  ## Betrieb im Container

  Siehe `deploy/unraid/README.md`.
  ```

- [ ] **Step 5: Dokumentation gegen `.env.example` abgleichen**

  Run:

  ```bash
  grep -oE '^[A-Z_]+=' .env.example | tr -d '=' | sort
  ```

  Expected: Die Liste der Variablennamen. Jeder Name außer `DATABASE_PATH` und `ATTACHMENTS_DIR` muss in der Tabelle in `deploy/unraid/README.md` vorkommen; fehlende ergänzen.

- [ ] **Step 6: Commit und Push**

  ```bash
  git add deploy/unraid README.md
  git commit -m "docs: Unraid-Deployment mit Compose-Datei und Betriebsanleitung" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  git push
  ```

- [ ] **Step 7: Abschließende Verifikation**

  Run:

  ```bash
  gh run watch --exit-status && git status --short
  ```

  Expected: Der Workflow-Lauf endet grün, `git status --short` gibt nichts aus.

  Danach führt Veit die Schritte aus `deploy/unraid/README.md` einmal auf dem Server aus. Erfolgskriterium: `curl -s http://UNRAID-IP:3080/api/health` liefert `{"status":"ok","worker":"enabled"}`. Solange MVP-Task 10 den Worker noch nicht geliefert hat, steht im Container-Log zusätzlich `[supervisor] src/worker/index.ts nicht vorhanden — starte nur das Dashboard`; das ist der erwartete Zustand und kein Fehler.

---

## Nach diesem Plan

Der MVP-Plan `docs/superpowers/plans/2026-08-30-ki-hausverwaltung-mvp.md` kann ab seinem (umgeschriebenen) Task 1 abgearbeitet werden. Sobald dessen Task 10 `src/worker/index.ts` liefert, startet der Supervisor beim nächsten Image-Build automatisch auch den Worker — am Dockerfile, am Workflow und an der Unraid-Konfiguration ist dafür nichts zu ändern.
