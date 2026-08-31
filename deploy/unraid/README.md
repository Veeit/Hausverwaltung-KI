# KI-Hausverwaltung auf Unraid betreiben

Das Image wird von GitHub Actions gebaut und liegt **öffentlich** unter
`ghcr.io/veeit/hausverwaltung-ki` (Repository `Veeit/Hausverwaltung-KI`). Es
enthält Dashboard und Mail-Worker in einem Container.

| Eigenschaft | Wert |
|---|---|
| Image | `ghcr.io/veeit/hausverwaltung-ki:latest` |
| Architektur | `linux/amd64` |
| Port im Container | `3000` |
| Persistenter Pfad | `/app/data` (SQLite-Datenbank und Mail-Anhänge) |
| Prozessbenutzer | uid `99`, gid `100` (`nobody:users`) |
| Health-Endpunkt | `GET /api/health` |

## 1. Registry-Zugriff

Das Paket ist **öffentlich**. Unraid kann das Image ohne Anmeldung ziehen —
kein `docker login` nötig, kein GitHub-Token einzurichten. Schritt 2/3 unten
funktionieren direkt.

<details>
<summary>Falls das Paket später auf privat gestellt wird</summary>

Dann muss sich Unraid an der Registry anmelden. Dafür wird ein GitHub-Token
mit dem Berechtigungsumfang `read:packages` benötigt (GitHub → Settings →
Developer settings → Personal access tokens).

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

</details>

## 2. Container einrichten — Variante A: Compose Manager

Das Plugin „Compose Manager" installieren, einen neuen Stack anlegen und den
Inhalt von `docker-compose.yml` aus diesem Verzeichnis einfügen. Danach die
Pflichtwerte ersetzen und den Stack starten.

## 3. Container einrichten — Variante B: „Add Container"

Docker-Tab → „Add Container" → Vorlage leer lassen und folgende Felder setzen:

| Feld | Wert |
|---|---|
| Name | `ki-hausverwaltung` |
| Repository | `ghcr.io/veeit/hausverwaltung-ki:latest` |
| Network Type | `Bridge` |
| Port (Host → Container) | `3080` → `3000`, TCP |
| Path (Host → Container) | `/mnt/user/appdata/ki-hausverwaltung` → `/app/data`, Read/Write |

Dazu diese Variablen (Typ „Variable"):

| Variable | Pflicht | Wert / Standard |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Schlüssel aus der Anthropic-Console (https://console.anthropic.com) |
| `MAIL_USER` | ja | Haupt-E-Mail-Adresse des Fastmail-Kontos (IMAP/SMTP-Login) |
| `MAIL_PASSWORD` | ja | Fastmail-App-Passwort mit IMAP- und SMTP-Berechtigung (nicht das normale Kontopasswort) |
| `MAIL_ALIAS` | ja | dedizierter Alias als VOLLSTÄNDIGE E-Mail-Adresse, z.B. `hausverwaltung-tool@ihre-domain.de` — nur Mails AN diesen Alias werden verarbeitet, er ist zugleich die Absenderadresse |
| `DASHBOARD_PASSWORD` | ja | Passwort für das Vermieter-Dashboard |
| `TZ` | nein | `Europe/Berlin` |
| `IMAP_HOST` | nein | `imap.fastmail.com` |
| `IMAP_PORT` | nein | `993` |
| `IMAP_MAILBOX` | nein | `INBOX` — Postfach-Ordner, der auf neue Mails an `MAIL_ALIAS` durchsucht wird. Sortiert eine Fastmail-Regel den Alias in einen eigenen Ordner (empfohlen), hier den exakten Ordnernamen eintragen, z.B. `Hausverwaltung TOOL FOM` |
| `IMAP_LOOKBACK_DAYS` | nein | `3` — wie viele Tage in die Vergangenheit die IMAP-Suche nach neuen Mails höchstens zurückreicht. Verhindert, dass der allererste Lauf gegen einen gewachsenen Ordner jede jemals eingegangene Mail als neu ansieht |
| `SMTP_HOST` | nein | `smtp.fastmail.com` |
| `SMTP_PORT` | nein | `465` |
| `MAIL_RATE_LIMIT_PER_HOUR` | nein | `20` — Kill-Switch: maximale Anzahl ausgehender Mails pro Stunde |
| `POLL_INTERVAL_MS` | nein | `30000` — IMAP-Polling-Intervall des Workers in Millisekunden |
| `LANDLORD_NAME` | nein | `Der Vermieter` — erscheint im Systemprompt der KI |
| `RUN_WORKER` | nein | `1` (auf `0` setzen, um nur das Dashboard zu starten) |

`DATABASE_PATH` und `ATTACHMENTS_DIR` sind im Image bereits korrekt gesetzt
und dürfen **nicht** überschrieben werden.

## 4. Prüfen, ob es läuft

```bash
curl -s http://UNRAID-IP:3080/api/health
```

Erwartet: `{"status":"ok","worker":"enabled"}`.

Antwortet der Endpunkt mit `{"status":"error", …}`, nennt die Meldung selbst
die Ursache. Es gibt genau zwei:

**`"Datenverzeichnis /app/data ist nicht beschreibbar"`** — das Verzeichnis
gibt es, aber der Container-Benutzer 99:100 darf nicht hineinschreiben.
Korrigieren mit:

```bash
chown -R 99:100 /mnt/user/appdata/ki-hausverwaltung
```

**`"Datenverzeichnis /app/data existiert nicht"`** — der Pfad ist im Container
gar nicht vorhanden. Das bedeutet fast immer, dass der Host-Pfad falsch
eingetragen ist (Tippfehler im Feld „Path" bzw. in der Compose-Datei) oder die
Freigabe `appdata` den Ordner noch nicht enthält. Ein `chown` hilft hier
**nicht** — es schlägt mit `No such file or directory` fehl. Stattdessen den
Ordner anlegen und die Container-Konfiguration prüfen:

```bash
mkdir -p /mnt/user/appdata/ki-hausverwaltung
chown -R 99:100 /mnt/user/appdata/ki-hausverwaltung
```

Danach im Docker-Tab kontrollieren, dass die Zuordnung wirklich
`/mnt/user/appdata/ki-hausverwaltung` → `/app/data` lautet, und den Container
neu starten.

Im Container-Log stehen beide Prozesse mit Präfix: `[web]` für das Dashboard,
`[worker]` für den Mail-Worker, `[supervisor]` für Start und Stopp.

Stirbt einer der beiden Prozesse, beendet der Supervisor absichtlich auch den
anderen und der Container endet — die Restart-Policy `unless-stopped` startet
ihn dann neu. Ein Container, der sich wiederholt neu startet, hat also ein
Problem in einem der beiden Prozesse; die Ursache steht im Log oberhalb der
`[supervisor] … beendet`-Zeile.

**Häufigster Fall: fehlende Pflichtvariable.** Endet der Container sofort
nach dem Start mit Exit-Code 1 und steht im Log

```
[worker] Ungültige oder fehlende Umgebungsvariablen:
  - MAIL_ALIAS: fehlt. Erwartet wird eine VOLLSTÄNDIGE E-Mail-Adresse, ...
```

(oder eine andere Variable), dann fehlt genau diese Pflichtvariable oder ihr
Wert ist ungültig — der Log nennt sie namentlich. Das ist kein Absturz,
sondern ein Konfigurationsfehler: der Worker verweigert bewusst den Start mit
unvollständiger Konfiguration, und der Supervisor beendet daraufhin auch das
Dashboard. Die fehlende(n) Variable(n) im Docker-Tab bzw. in der
Compose-Datei ergänzen und den Container neu starten. Ein Container, der in
so einer Neustart-Schleife hängt, meldet also ein Konfigurationsproblem, kein
Absturz-Bug — die Lösung steht wörtlich im Log.

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
