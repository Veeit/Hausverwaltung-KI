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

- **Next.js-App** (`npm run dev`): öffentliche Produktseite auf `/` und
  darunter das Vermieter-Dashboard auf `/app` (Übersicht, Vorgänge,
  Genehmigungen, Eskalationen, Stammdaten, Dokumente, Warteliste) mit Server
  Actions. Geschützt wird ausschliesslich `/app`; die Produktseite und
  `/login` sind öffentlich (siehe `src/proxy.ts`).
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
3. Zustellung festlegen — zwei gleichwertige Wege, siehe unten.
4. Die Alias-Adresse ist `MAIL_ALIAS` für die `.env`; sie ist gleichzeitig
   Eingangsfilter und Absenderadresse aller System-Mails.

**Wichtig:** Der Worker fasst nur Mails an, die an diesen Alias adressiert
sind — und zwar doppelt abgesichert. Erstens schränkt bereits die IMAP-Suche
serverseitig auf To/Cc-Treffer für den Alias ein, sodass private Post gar
nicht erst heruntergeladen wird. Zweitens wird jede heruntergeladene Mail vor
der Verarbeitung noch einmal exakt gegen die Alias-Adresse geprüft — auch ein
zufälliger Teilstring-Treffer der (laut RFC 3501 nicht exakten) IMAP-Suche
fällt dabei heraus. Nur Mails, die diese Prüfung bestehen, werden überhaupt
als verarbeitet markiert; alles andere bleibt unangetastet.

#### Wohin soll der Alias zustellen?

**Option A — normale Inbox (Standard, keine Konfiguration nötig).** Der
Worker durchsucht per Default `INBOX` und filtert dort selbst auf die
Alias-Adresse (To/Cc, siehe oben). Du kannst dein normales
Fastmail-Hauptpostfach also gefahrlos anbinden — deine private Post wird
weder verarbeitet noch als gelesen markiert.

**Option B — eigener Ordner per Fastmail-Regel (empfohlen).** Lege in
**Einstellungen → Regeln** eine Regel an, die Mails an den Alias in einen
eigenen Ordner verschiebt (z. B. `Hausverwaltung TOOL FOM`), statt sie in der
Inbox zu belassen. Vorteil: Der Worker bekommt die private Inbox dann
überhaupt nicht mehr zu Gesicht — er öffnet ausschließlich den konfigurierten
Ordner. In diesem Fall muss `IMAP_MAILBOX` in der `.env` auf **genau** diesen
Ordnernamen gesetzt werden (siehe Konfigurationstabelle unten). Bleibt
`IMAP_MAILBOX` auf dem Default `INBOX` stehen, während die Regel längst in
einen anderen Ordner zustellt, findet der Worker dort schlicht nichts — die
Poll-Läufe laufen scheinbar fehlerfrei, aber leer.

**Gelesen-Status spielt für die Verarbeitung keine Rolle mehr.** Frühere
Versionen erkannten neue Mails ausschließlich am Gelesen-Status
(`\Seen`) — öffnest du eine Test-Mail zur Kontrolle in einem Mail-Client
(Fastmail-Webmail, Handy-App, …), markiert das sie automatisch als gelesen,
und der Worker überging sie dauerhaft, obwohl sie weiterhin korrekt im
richtigen Ordner lag. Genau das ist im ersten Live-Test passiert. Das ist
behoben: Erlaubt dein IMAP-Server eigene Schlagworte (Fastmail tut das), führt
der Worker den Verarbeitungsstatus stattdessen über ein eigenes,
projektspezifisches Schlagwort (`KIHausverwaltungVerarbeitet`). Ob eine Mail
davor gelesen wurde oder nicht, ist dafür unerheblich — ein versehentliches
Anklicken verhindert die Verarbeitung also nicht mehr. `\Seen` wird nach
erfolgreicher Verarbeitung weiterhin zusätzlich gesetzt, aber nur noch aus
Komfortgründen: damit erledigte Mails dem Vermieter nicht als ungelesen im
Ordner liegen bleiben.

Damit ein allererster Lauf gegen einen bereits gewachsenen Ordner nicht jede
jemals an den Alias gegangene Mail auf einmal als neu ansieht (die
Schlagwort-Suche verzichtet ja bewusst auf den Gelesen-Filter, der das bisher
implizit verhinderte), begrenzt `IMAP_LOOKBACK_DAYS` diese Suche zusätzlich
zeitlich (Default 3 Tage, siehe Konfigurationstabelle unten). Eine
Message-ID-Deduplizierung in der Datenbank verhindert zusätzlich, dass eine
Mail doppelt verarbeitet wird.

Unterstützt dein IMAP-Server keine eigenen Schlagworte (bei Fastmail nicht der
Fall, aber nicht jeder Anbieter erlaubt das), fällt der Worker automatisch auf
den alten Gelesen-Status zurück — dann gilt die oben beschriebene Falle
weiterhin, und `IMAP_LOOKBACK_DAYS` bleibt ohne Wirkung. Welchen der beiden
Wege dein Server bekommt, meldet der Worker beim Start einmalig im Log
(`[imap] Server erlaubt eigene Schlagworte …` bzw. `[imap] Server erlaubt
KEINE eigenen Schlagworte …` mit Hinweis auf die damit verbundene
Einschränkung).

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
| `IMAP_MAILBOX` | Postfach-Ordner, der auf Alias-Mails durchsucht wird — bei Zustellung per Fastmail-Regel in einen eigenen Ordner (Option B oben) auf dessen exakten Namen setzen | `INBOX` |
| `IMAP_LOOKBACK_DAYS` | Wie viele Tage in die Vergangenheit die Suche nach neuen Mails höchstens zurückreicht (nur relevant, wenn der Server eigene Schlagworte unterstützt, siehe oben) | `3` |
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

**http://localhost:3000** zeigt die öffentliche Produktseite. Das Dashboard
liegt darunter auf **http://localhost:3000/app** und ist per
`DASHBOARD_PASSWORD` aus der `.env` geschützt; das Passwortfeld erreichen Sie
über „Anmelden" oben rechts oder direkt unter `/login`.

Wer ohne gültiges Cookie einen `/app`-Pfad aufruft, landet auf der
Produktseite — nicht auf einem nackten Passwortfeld. Das ist Absicht: Die
Seite ist der Einstieg für alle, die das Produkt noch nicht kennen. Sind Sie
angemeldet, wechselt der Knopf oben rechts auf „Zum Dashboard".

### Warteliste

Das Produkt ist noch nicht buchbar. Die Produktseite sammelt deshalb
Interessenten: Das Formular unter `/#warteliste` nimmt E-Mail-Adresse,
Größenklasse und einen optionalen Demo-Wunsch entgegen und schreibt sie in
die Tabelle `waitlist`. Im Dashboard listet **Warteliste** (`/app/warteliste`)
die Eintragungen, jeweils mit „Löschen" für Streichungswünsche.

`joinWaitlist` in `src/app/actions/waitlist.ts` ist die **einzige Server
Action ohne `requireAuth`** — sie ist über die öffentliche Seite für jeden
erreichbar. Deshalb dort bewusst eng gefasst: nur drei Felder (kein
Freitext), Adresse längenbegrenzt und normalisiert, eine bereits eingetragene
Adresse aktualisiert ihren Eintrag statt einen zweiten anzulegen, und ein
verstecktes Köderfeld fängt einfache Bots ab. **Nicht** abgedeckt ist ein
Angreifer, der viele verschiedene erfundene Adressen einträgt — dagegen hilft
nur eine Ratenbegrenzung pro IP, die ohne Reverse-Proxy nicht verlässlich
umsetzbar ist.

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
- Kein Selbstregistrieren und keine Bezahlung: Die Produktseite führt auf
  eine Warteliste, Zugänge werden von Hand vergeben. Die Preise auf der
  Seite sind als geplante Preise gekennzeichnet und nicht buchbar.
- Das öffentliche Wartelisten-Formular hat keine Ratenbegrenzung pro IP
  (siehe Abschnitt „Warteliste" oben).
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
- Erlaubt der IMAP-Server keine eigenen Schlagworte (siehe Abschnitt
  „Fastmail einrichten" oben), fällt der Worker auf den Gelesen-Status
  (`\Seen`) als Verarbeitungsmerkmal zurück — dann verhindert ein
  versehentliches Anklicken einer Mail im Mail-Client die Verarbeitung wieder,
  genau wie vor diesem Fix. Der Worker meldet diesen Fall beim Start einmalig
  im Log.
