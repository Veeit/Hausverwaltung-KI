# KI-Hausverwaltung (Proof of Concept)

KI-gestützte Hausverwaltung per E-Mail: Mieter melden Anliegen (z. B. „Türschloss
klemmt") an eine dedizierte E-Mail-Adresse. Ein KI-Agent (Claude Opus 5)
übernimmt den Support-Dialog, sammelt gezielt Informationen (Problem,
Dringlichkeit, Foto, 2–3 Terminfenster), bereitet einen Genehmigungsantrag für
den Vermieter vor und kontaktiert nach dessen Freigabe per Klick einen passenden
Handwerker — inklusive der Terminfenster des Mieters. Der Vermieter steuert
alles über ein deutschsprachiges Dashboard.

**Status: Proof of Concept.** Echter E-Mail-Ein-/Ausgang über ein
Fastmail-Postfach, echte KI — aber bewusste Abkürzungen (siehe „Bekannte
Grenzen" unten).

## Architektur (Kurzüberblick)

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
                  Next.js Dashboard ◀─────┘
```

- **Next.js-App** (`npm run dev`): Vermieter-Dashboard (Übersicht, Vorgänge,
  Genehmigungen, Eskalationen, Stammdaten, Dokumente) mit Server Actions.
- **Worker** (`npm run worker`): langlaufender Prozess — pollt IMAP, speichert
  neue Mails, startet pro Mail einen Agent-Lauf, versendet Antworten per SMTP.
- **KI-Agent**: Claude Opus 5 mit fünf Tools (`search_documents`,
  `update_ticket`, `request_approval`, `ask_landlord`, `send_reply`). Harte,
  technisch erzwungene Regeln: Mails gehen ausschließlich an in der Datenbank
  hinterlegte Mieter-/Handwerker-Adressen (Whitelist), alles Richtung
  Handwerker nur nach Vermieter-Klick im Dashboard, Rate-Limit mit Kill-Switch.
- **Datenhaltung**: SQLite (better-sqlite3 + Drizzle ORM), Volltextsuche über
  FTS5 für die Wissensquelle, Mail-Anhänge auf Disk unter `data/attachments/`.

## Voraussetzungen

- Node.js >= 20 und npm
- Ein Anthropic API Key (https://console.anthropic.com)
- Ein Fastmail-Konto mit App-Passwort und dediziertem Alias (Anleitung unten)
- Für den Live-Test: zwei eigene E-Mail-Adressen (eine spielt den „Mieter",
  eine den „Handwerker")

## Fastmail einrichten (Schritt für Schritt)

### 1. App-Passwort erstellen (für IMAP + SMTP)

1. Bei Fastmail im Browser anmelden.
2. **Einstellungen → Passwörter & Sicherheit** öffnen.
3. Im Abschnitt **App-Passwörter** auf **Neues App-Passwort** klicken.
4. Name z. B. „KI-Hausverwaltung", als Zugriff **Mail (IMAP/SMTP)** wählen.
5. Das angezeigte Passwort sofort kopieren (es wird nur einmal angezeigt) —
   das ist `MAIL_PASSWORD` für die `.env`.

### 2. Dedizierten Alias anlegen

1. **Einstellungen → Mail → Aliasse** öffnen (je nach Fastmail-Oberfläche
   unter „Senden & Empfangen").
2. **Neuen Alias erstellen**, z. B. `hausverwaltung@deine-domain.de` oder
   `hausverwaltung.deinname@fastmail.com`.
3. Zustellung in die normale Inbox belassen — der Worker filtert selbst auf
   die Alias-Adresse (To/Cc).
4. Die Alias-Adresse ist `MAIL_ALIAS` für die `.env`; sie ist gleichzeitig
   Eingangsfilter und Absenderadresse aller System-Mails.

**Wichtig:** Der Worker fasst nur Mails an, die an diesen Alias adressiert
sind — und zwar doppelt abgesichert. Erstens schränkt bereits die IMAP-Suche
serverseitig auf To/Cc-Treffer für den Alias ein, sodass private Post gar
nicht erst heruntergeladen wird. Zweitens wird jede heruntergeladene Mail vor
der Verarbeitung noch einmal exakt gegen die Alias-Adresse geprüft — auch ein
zufälliger Teilstring-Treffer der (laut RFC 3501 nicht exakten) IMAP-Suche
fällt dabei heraus. Nur Mails, die diese Prüfung bestehen, werden überhaupt
als gelesen markiert; alles andere bleibt unangetastet und ungelesen. Du
kannst dein normales Fastmail-Hauptpostfach also gefahrlos anbinden — deine
private Post wird weder verarbeitet noch als gelesen markiert.

## Konfiguration (`.env`)

```bash
cp .env.example .env
```

Dann die Werte eintragen:

| Variable | Bedeutung | Beispiel / Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API Key (Pflicht) | `sk-ant-…` |
| `MAIL_USER` | Fastmail-Login (Haupt-Adresse) | `ich@fastmail.com` |
| `MAIL_PASSWORD` | Fastmail-**App-Passwort** (nicht das Kontopasswort) | — |
| `MAIL_ALIAS` | Dedizierter Alias: Eingangsfilter + Absenderadresse — **vollständige Adresse, nicht nur der Namensteil vor dem @!** | `hausverwaltung-tool@ihre-domain.de` |
| `DASHBOARD_PASSWORD` | Passwort für das Dashboard-Login | — |
| `IMAP_HOST` / `IMAP_PORT` | IMAP-Server | `imap.fastmail.com` / `993` |
| `SMTP_HOST` / `SMTP_PORT` | SMTP-Server | `smtp.fastmail.com` / `465` |
| `MAIL_RATE_LIMIT_PER_HOUR` | Kill-Switch: max. ausgehende Mails pro Stunde | `20` |
| `DATABASE_PATH` | Pfad zur SQLite-Datei | `./data/hausverwaltung.db` |
| `ATTACHMENTS_DIR` | Ablageordner für Mail-Anhänge | `./data/attachments` |
| `POLL_INTERVAL_MS` | IMAP-Poll-Intervall in Millisekunden | `30000` |
| `LANDLORD_NAME` | Name des Vermieters (erscheint im KI-Kontext) | `Der Vermieter` |

## Installation & Start

```bash
npm install
npm run seed
```

`npm run seed` legt Beispieldaten an (1 Objekt, 2 Mieter, 3 Handwerker) —
nur, wenn die Datenbank noch leer ist. Die Beispiel-E-Mail-Adressen (`…@example.com`)
müssen für den Live-Test im Dashboard unter **Stammdaten** auf echte
Testadressen geändert werden.

Dann zwei Terminals öffnen:

```bash
# Terminal 1 — Dashboard
npm run dev

# Terminal 2 — Worker (IMAP-Polling + KI-Agent + SMTP-Versand)
npm run worker
```

Dashboard: **http://localhost:3000** — Login mit dem `DASHBOARD_PASSWORD`
aus der `.env`.

### Worker automatisch neu starten

`npm run worker` fängt Fehler einer einzelnen Poll-Runde selbst ab und läuft
weiter. Stürzt der **Prozess** ab (z. B. unbehandelte Rejection außerhalb der
Schleife), bleibt er allerdings stehen. Für längeren Betrieb den Worker
deshalb in einer Neustart-Schleife starten:

```bash
until npm run worker; do echo "Worker beendet — Neustart in 5s"; sleep 5; done
```

Eingehende Mails werden vor der Verarbeitung gespeichert (Status `pending`);
während der Agent an einer Nachricht arbeitet, steht sie auf `processing`.
Stürzt der Prozess genau in diesem Moment ab — dem mit Abstand größten
Zeitfenster im System, da ein einzelner Agent-Lauf mehrere Sekunden bis
Minuten dauern kann —, setzt der Worker beim nächsten Start automatisch alle
noch in `processing` hängenden Nachrichten auf `pending` zurück, sodass sie
erneut verarbeitet werden. Ohne Neustart zeigt das Dashboard (Übersicht,
Abschnitt „Hängende Verarbeitung") Nachrichten an, die seit mehr als fünf
Minuten in `processing` stehen.

## Testablauf (Live-Test mit zwei eigenen Mailadressen)

Du spielst Mieter (Adresse A) und Handwerker (Adresse B):

1. Dashboard → **Stammdaten → Mieter**: E-Mail von „Max Mustermann" auf deine
   Adresse A ändern.
2. Dashboard → **Stammdaten → Handwerker**: E-Mail von „Sven Schloss"
   (Schlüsseldienst) auf deine Adresse B ändern.
3. Von Adresse A eine Mail an den Alias (`MAIL_ALIAS`) senden, z. B.:
   „Guten Tag, mein Türschloss klemmt seit gestern stark, ich bekomme die Tür
   kaum noch auf."
4. Nach spätestens ~30 Sekunden (Poll-Intervall) antwortet die KI an Adresse A:
   Sie legt ein Ticket an und stellt Rückfragen (Details, Dringlichkeit, Foto,
   **2–3 Terminfenster**).
5. Als Mieter **auf die Mail antworten** (den `[HV-…]`-Tag im Betreff
   beibehalten) und die Fragen beantworten, inklusive Terminfenster.
6. Dashboard → **Genehmigungen**: Die KI hat einen Antrag mit
   Handwerker-Vorschlag und fertigem Mail-Entwurf erstellt. Entwurf bei Bedarf
   **bearbeiten**, dann **genehmigen** (oder mit Begründung ablehnen — dann
   informiert die KI den Mieter).
7. Adresse B erhält die Handwerker-Anfrage. Als Handwerker **auf die Mail
   antworten** und einen Termin nennen (Betreff-Tag beibehalten).
8. Liegt der Termin in einem der genannten Terminfenster, bestätigt die KI
   ihn beiden Seiten (Ticket-Status `terminiert`). Liegt er außerhalb,
   erscheint eine **Eskalation** im Dashboard.
9. Abschluss: im Dashboard den Vorgang auf `erledigt` setzen — oder der Mieter
   meldet per Mail, dass das Problem behoben ist.

Mails von Adressen, die keinem Mieter/Handwerker zugeordnet sind, werden
**nicht** beantwortet; sie erscheinen in der Übersicht unter „Unzugeordnet".

## Smoke-Test (ohne Postfach)

```bash
npm run smoke
```

Spielt eine Mieter-Mail („Türschloss klemmt") direkt in die Datenbank ein und
lässt den **echten** Agenten laufen. Benötigt `ANTHROPIC_API_KEY` in der
`.env` und **kostet echte API-Tokens**. Es wird **nichts versendet** —
ausgehende Mails werden nur auf der Konsole ausgegeben. Vorher `npm run seed`
ausführen. Achtung: Das Skript schreibt in die konfigurierte Entwicklungs-DB
(`DATABASE_PATH`).

## Tests & Build

```bash
npm run test     # Vitest: komplette Unit- und Szenario-Suite (ohne Netz, ohne API-Kosten)
npm run build    # Produktions-Build des Dashboards
```

## Bekannte Grenzen (bewusste PoC-Abkürzungen)

- Ein Vermieter, kein Multi-Tenancy, kein Benutzersystem — die
  Dashboard-Anmeldung ist ein einzelnes Passwort aus der `.env`.
- IMAP-Polling (~30 s) statt Push/Webhooks; SQLite statt Postgres;
  FTS5-Volltextsuche statt Embeddings/Vektor-Datenbank.
- Terminfindung in **einem Durchgang**: Der Handwerker nennt einen Termin;
  passt er in kein Terminfenster, eskaliert die KI an den Vermieter — kein
  Verhandlungs-Pingpong.
- Keine Rechnungs- und Kostenverfolgung.
- Nur E-Mail als Kanal (SMS/WhatsApp nicht angebunden; ein Kanal-Interface
  ist als Erweiterungspunkt vorhanden).
- Mieter-Erkennung rein über die Absenderadresse; Handwerker-Zuordnung über
  den `[HV-…]`-Betreff-Tag.
- Dokumenten-Upload (Dashboard → Dokumente) ist auf **8 MB** pro Datei
  begrenzt (PDF, TXT, Markdown); darüber erscheint eine deutsche
  Fehlermeldung statt eines rohen Framework-Fehlers.
- Kill-Switch: Überschreitet der Mail-Ausgang `MAIL_RATE_LIMIT_PER_HOUR`,
  pausiert der Worker; im Dashboard erscheint ein roter Banner mit
  „Fortsetzen"-Button.
- Verworfene Betreff-Tags (jemand nennt eine fremde oder nicht mehr gültige
  Vorgangsnummer `[HV-n]`) landen nur im Server-Log
  (`src/lib/ticketAccess.ts`); das Dashboard zeigt sie nirgends an. Ein
  Vermieter bemerkt wiederholtes Raten fremder Vorgangsnummern also nur bei
  Log-Einsicht, nicht im Dashboard selbst.
- Ein bereits beauftragter Handwerker lässt sich nicht gezielt „abbestellen":
  Das System kennt nur den Weg über einen neuen Genehmigungsantrag für einen
  anderen Handwerker (der den alten dann als aktuell Beauftragten ablöst).
  Es gibt keine Aktion, die einen beauftragten Handwerker ausdrücklich vom
  Vorgang abzieht, ohne gleichzeitig einen neuen zu beauftragen.
