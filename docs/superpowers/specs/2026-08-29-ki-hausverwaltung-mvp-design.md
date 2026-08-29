# KI-Hausverwaltung — MVP/PoC Design

**Datum:** 2026-08-29
**Status:** Entwurf genehmigt (Brainstorming mit Veit, alle Abschnitte bestätigt)

## 1. Ziel & Kontext

Ein Tool, das Hausverwaltung per KI automatisiert. Langfristiges Ziel: Verkauf an
andere Vermieter (SaaS). Diese Iteration ist ein **Proof of Concept** mit echtem
Input/Output, aber bewussten Abkürzungen — kein poliertes Produkt.

**Kernszenario:** Ein Mieter meldet per E-Mail ein Problem (z.B. defektes
Türschloss). Die KI übernimmt den Support-Dialog, sammelt gezielt Informationen,
bereitet einen Genehmigungsantrag für den Vermieter vor und kontaktiert nach
dessen Freigabe per Klick einen Handwerker per E-Mail — inklusive Terminfenstern
des Mieters.

## 2. Getroffene Grundsatzentscheidungen

| Frage | Entscheidung |
|---|---|
| Einsatzzweck | PoC mit echtem Input/Output; Ziel später Produkt für Vermieter |
| Mieter-Kanal | **E-Mail** (jeder hat sie, kein Freigabeprozess, passt zum Handwerker-Kontakt) |
| Tech-Stack | **TypeScript / Next.js**, SQLite (Drizzle ORM), ein Repo |
| E-Mail-Anbindung | **Fastmail-Account von Veit**, dedizierter Alias, IMAP-Polling + SMTP |
| Architektur | **Monolith:** Next.js (Dashboard + API) + separater Worker-Prozess, gemeinsame DB/Codebasis |
| KI | **Claude Opus 5** (`claude-opus-5`) über das Anthropic TypeScript SDK, Tool-Use (Tool Runner) |

## 3. Architektur

```
Mieter ──E-Mail──▶ Fastmail (Alias hausverwaltung@…)
                      │  IMAP-Polling (~30 s)
                      ▼
                  Worker-Prozess ──▶ KI-Agent (Claude Opus 5 + Tools)
                      │                   │
                      │  SMTP             │ liest/schreibt
                      ▼                   ▼
                  Antworten            SQLite (Drizzle)
                                          ▲
                                          │
                  Next.js Dashboard ◀─────┘
                  (Vermieter: Genehmigungen, Eskalationen, Stammdaten, Dokumente)
```

**Komponenten:**

1. **Next.js-App** — Vermieter-Dashboard + API-Routes. Deutschsprachige UI.
2. **Worker** — langlaufendes Node-Skript: pollt IMAP, persistiert neue Mails,
   ruft den Agenten auf, versendet Antworten per SMTP. Teilt DB-Layer und
   Domänenlogik mit der Next.js-App (gemeinsamer `src/lib`-Code).
3. **KI-Agent** — Claude Opus 5 mit Tool-Use; pro eingehender Mail ein
   Agent-Lauf mit vollem Gesprächsverlauf + Ticket-Zustand als Kontext.

**Fastmail-Isolation:** Der Worker verarbeitet ausschließlich Mails, die an den
konfigurierten Alias adressiert sind (Filter auf To/Cc). Veits private Post
bleibt unberührt.

**Kanal-Abstraktion:** E-Mail-Ein-/Ausgang liegt hinter einem schmalen
Interface (`Channel`), damit WhatsApp/SMS später andockbar sind, ohne die
Agent-Logik anzufassen.

## 4. Datenmodell (SQLite, Kerntabellen)

| Tabelle | Inhalt |
|---|---|
| `tenants` | Mieter: Name, E-Mail, Objekt/Wohnung |
| `properties` | Objekte: Adresse (Wohnungsbezeichnung als Feld am Mieter) |
| `contractors` | Handwerker: Name, Gewerk (z.B. Sanitär, Elektrik, Schlüsseldienst), E-Mail |
| `conversations` | Ein Mail-Verlauf mit einem Mieter bzw. Handwerker |
| `messages` | Jede ein-/ausgehende Nachricht: Richtung, Absender, Empfänger, Betreff, Body, Rolle (mieter/ki/vermieter/handwerker), Zeitstempel, Verarbeitungsstatus |
| `tickets` | Vorgang: Typ (`reparatur` / `frage` / `sonstiges`), Status (s.u.), Zusammenfassung, gesammelte Infos (JSON), Dringlichkeit, Referenzen auf Mieter/Handwerker/Conversation |
| `approvals` | Genehmigungsantrag: Zusammenfassung, vorgeschlagener Handwerker, Mail-Entwurf, Entscheidung + Begründung |
| `documents` | Wissensquelle: Dateiname, extrahierter Text (FTS5-indiziert) |
| `escalations` | Frage der KI an den Vermieter + dessen Antwort, Ticket-Referenz |
| `attachments` | Mail-Anhänge (Fotos etc.), Datei auf Disk, Referenz an Message |

**Ticket-Statusmaschine:**
`neu → infosammlung → wartet_auf_genehmigung → genehmigt → handwerker_angefragt → terminiert → erledigt`
Zusätzlich: `eskaliert` (wartet auf Vermieter-Antwort) und `abgelehnt`.

**Mieter-Erkennung:** über die Absender-Adresse. Mails unbekannter Absender
werden **nicht** beantwortet; sie erscheinen im Dashboard unter „Unzugeordnet".
Handwerker-Antworten werden über einen Ticket-Tag im Betreff (`[HV-<id>]`)
zugeordnet.

## 5. Reparatur-Workflow (Kernablauf)

1. **Eingang:** Mieter mailt Problem → Worker ordnet Mail zu, startet Agent.
2. **Infosammlung:** Agent legt Ticket an (`infosammlung`), stellt gezielte
   Rückfragen: Was ist defekt? Seit wann? Dringlichkeit (z.B. Tür noch
   abschließbar?), Foto, **2–3 Terminfenster** des Mieters. Fotos wertet Claude
   per Vision direkt aus.
3. **Genehmigungsvorlage:** Bei ausreichenden Infos erstellt der Agent den
   Antrag: Zusammenfassung, Dringlichkeit, Handwerker-Vorschlag (Gewerk-Match
   aus `contractors`), fertiger Entwurf der Handwerker-Mail (Objektadresse,
   Problem, Terminfenster). Status → `wartet_auf_genehmigung`. Mieter erhält
   Zwischenbescheid.
4. **Vermieter-Entscheidung im Dashboard:**
   - ✅ **Genehmigen** → Handwerker-Mail wird gesendet, Status `handwerker_angefragt`
   - ✏️ **Bearbeiten** → Entwurf anpassen, dann senden
   - ❌ **Ablehnen** mit Begründung → Agent formuliert Absage/Alternative an Mieter
5. **Handwerker-Antwort:** kommt an denselben Alias, Zuordnung via `[HV-<id>]`.
   Agent extrahiert den Terminvorschlag. Liegt er in einem der Terminfenster
   des Mieters, bestätigt die KI ihn **beiden Seiten** (die kurze Bestätigung
   an den Handwerker ist durch die ursprüngliche Genehmigung gedeckt) →
   `terminiert`. Liegt er außerhalb → Eskalation an den Vermieter.
6. **Abschluss:** Vermieter (Dashboard) oder Mieter (Mail) meldet erledigt →
   `erledigt`.

Terminfindung ist im PoC **ein Durchgang** (Handwerker nennt Termin, Mieter wird
informiert); Verhandlungs-Pingpong eskaliert an den Vermieter.

## 6. KI-Agent

- **Modell:** `claude-opus-5`, Anthropic TypeScript SDK, adaptives Thinking,
  Tool Runner für die Agent-Schleife.
- **Kontext pro Lauf:** Systemprompt (Rolle, Regeln, Vermieter-/Objektdaten),
  kompletter Gesprächsverlauf der Conversation, aktueller Ticket-Zustand.
- **Tools:**
  - `search_documents` — Volltextsuche in der Wissensquelle
  - `update_ticket` — Vorgang anlegen/aktualisieren, Status setzen, Infos ablegen
  - `request_approval` — Genehmigungsantrag inkl. Handwerker-Mail-Entwurf erstellen
  - `ask_landlord` — Eskalation ins Dashboard; Mieter erhält Zwischenbescheid
  - `send_reply` — Antwort-Mail an den Mieter senden

**Harte Regeln (technisch erzwungen, nicht nur per Prompt):**

- Mails an Mieter schreibt die KI autonom; **alles Richtung Handwerker nur nach
  Vermieter-Klick**.
- Empfänger-Whitelist: gesendet wird ausschließlich an in der DB hinterlegte
  Mieter- und Handwerker-Adressen.
- Kill-Switch: max. konfigurierbare Anzahl ausgehender Mails pro Stunde; bei
  Überschreitung stoppt der Worker und meldet es im Dashboard.
- Eingehende Mails sind **Daten, keine Anweisungen** (Prompt-Injection-Schutz
  im Systemprompt verankert; kritische Aktionen sind ohnehin durch Whitelist +
  Genehmigungspflicht abgesichert).
- Wenn die KI nicht weiterweiß → `ask_landlord`, nie raten oder schweigen.

## 7. Dashboard (Next.js)

- **Übersicht** — offene Vorgänge nach Status; wartende Genehmigungen und
  Eskalationen prominent; zuletzt eingegangene Mails
- **Vorgangsdetail** — kompletter Verlauf (Mieter ↔ KI ↔ Handwerker),
  Ticket-Daten, manuelle Aktionen (Status ändern, selbst antworten)
- **Genehmigungen** — Karten mit Zusammenfassung + Mail-Entwurf, drei Aktionen
- **Eskalationen** — offene Fragen der KI; Antwort geht als Kontext an den
  Agenten, der daraus die Mieter-Antwort formuliert
- **Stammdaten** — CRUD für Mieter, Objekte, Handwerker
- **Dokumente** — Upload (PDF/TXT/MD), Liste, Löschen

**Auth (PoC):** ein einfaches Passwort aus der `.env` (Cookie-Session), kein
Benutzersystem.

## 8. Wissensquelle

Upload im Dashboard → Textextraktion (pdf-parse für PDFs, sonst Rohtext) →
Speicherung in SQLite mit **FTS5-Volltextindex**. `search_documents` macht
Volltextsuche. Keine Embeddings/Vektor-DB im PoC; die Suche liegt hinter einem
Interface und ist später austauschbar.

## 9. Fehlerbehandlung

- Eingehende Mails werden **erst persistiert, dann verarbeitet**. Bei
  Agent-Fehler: Markierung „unverarbeitet", 2 automatische Retries, danach
  sichtbar im Dashboard. Nichts geht stumm verloren.
- Jede ausgehende Mail wird vor dem Versand geloggt.
- Worker-Crashes: Prozess startet neu (z.B. via `tsx watch`/Supervisor) und
  setzt bei den unverarbeiteten Mails wieder auf; IMAP-Verarbeitung ist
  idempotent (Message-ID-Dedupe).

## 10. Testing

- **Unit-Tests:** Mail-Parsing, Mieter-/Handwerker-Zuordnung, Ticket-Statusmaschine,
  Empfänger-Whitelist, Kill-Switch (Vitest, test-first).
- **Agent-Szenarien:** Golden-Tests mit gemockten Tools („Türschloss kaputt" →
  erwartete Tool-Aufrufe/Statusübergänge).
- **Live-Test:** Veit spielt Mieter und Handwerker mit zwei Testadressen gegen
  das echte Fastmail-Postfach.

## 11. Bewusste PoC-Abkürzungen

- Ein Vermieter, kein Multi-Tenancy, kein Benutzersystem
- IMAP-Polling statt Webhooks; SQLite statt Postgres; FTS5 statt Embeddings
- Terminfindung ohne Verhandlungsrunden
- Keine Rechnungs-/Kostenverfolgung, keine SMS/WhatsApp (Kanal-Interface
  vorhanden)

## 12. Voraussetzungen (Veit)

- Anthropic API Key (`ANTHROPIC_API_KEY`)
- Fastmail App-Passwort (IMAP + SMTP) und der dedizierte Alias
- `.env` mit diesen Werten + Dashboard-Passwort + Mail-Rate-Limit
