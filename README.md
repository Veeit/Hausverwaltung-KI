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

## Schnellstart

```bash
npm install
cp .env.example .env   # Pflichtwerte eintragen (siehe Kommentare in der Datei)
npm run dev            # Dashboard auf http://localhost:3000
npm run worker         # E-Mail-Worker, separates Terminal
npm test               # Unit-Tests
```
