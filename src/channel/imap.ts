import { ImapFlow, type MailboxLockObject } from "imapflow";
import { getEnv } from "@/env";
import { parseRawEmail } from "@/channel/parse";
import type { IncomingEmail } from "@/channel/types";

/**
 * Eigenes IMAP-Schlagwort (Keyword), das eine erfolgreich verarbeitete Mail
 * markiert — siehe supportsCustomKeywords() und die ausführliche Begründung
 * bei fetchNewEmails(). Bewusst projektspezifisch benannt (statt z. B.
 * "Processed" oder "Verarbeitet"), damit es nicht mit einem Schlagwort eines
 * anderen Tools kollidiert, das im selben Postfach/Ordner mitliest.
 */
const PROCESSED_KEYWORD = "KIHausverwaltungVerarbeitet";

/**
 * Wird genau einmal pro Prozesslaufzeit auf true gesetzt (siehe
 * announceCapabilityOnce) — verhindert, dass die Fähigkeits-Meldung bei
 * jedem Poll-Durchlauf (Sekunden-Takt, siehe POLL_INTERVAL_MS) erneut im Log
 * erscheint. Die Fähigkeit eines Servers ändert sich zur Laufzeit ohnehin
 * nicht; eine einmalige Meldung reicht dem Betreiber.
 */
let capabilityAnnounced = false;

/**
 * Loggt EINMAL pro Prozesslaufzeit, welcher Weg zur Erkennung bereits
 * verarbeiteter Mails genutzt wird — Pflichtangabe laut Auftrag, damit ein
 * Betreiber ohne Tests im Log nachvollziehen kann, welches Verhalten sein
 * Server bekommt. Im Rückfall-Fall wird zusätzlich genannt, welche
 * Einschränkung er sich damit einhandelt (siehe fetchNewEmails).
 */
function announceCapabilityOnce(usesCustomKeyword: boolean): void {
  if (capabilityAnnounced) return;
  capabilityAnnounced = true;
  if (usesCustomKeyword) {
    console.log(
      `[imap] Server erlaubt eigene Schlagworte (permanentFlags enthält "\\*") — ` +
        `bereits verarbeitete Mails werden über das IMAP-Schlagwort "${PROCESSED_KEYWORD}" ` +
        `erkannt, nicht mehr über den Gelesen-Status.`,
    );
  } else {
    console.warn(
      `[imap] Server erlaubt KEINE eigenen Schlagworte (permanentFlags ohne "\\*") — ` +
        `Rückfall auf den Gelesen-Status (\\Seen) zur Erkennung bereits verarbeiteter Mails. ` +
        `Einschränkung: Wird eine Mail im Mailprogramm geöffnet, BEVOR der Worker sie abgeholt ` +
        `hat, gilt sie fälschlich als bereits verarbeitet und wird NIE an die KI weitergereicht.`,
    );
  }
}

/**
 * Prüft, ob der IMAP-Server auf dem gerade per getMailboxLock() geöffneten
 * Postfach-Ordner eigene (benutzerdefinierte) Schlagworte zulässt. MUSS erst
 * NACH erfolgreichem getMailboxLock() aufgerufen werden — client.mailbox
 * wird erst durch das dabei intern ausgeführte SELECT befüllt.
 *
 * Kriterium (mit dem Auftraggeber abgestimmt und gegen dessen Server
 * geprüft): permanentFlags muss die Sonderflagge "\*" enthalten. Fehlt
 * permanentFlags ganz oder enthält sie "\*" nicht, gilt der Server
 * KONSERVATIV als "unterstützt keine eigenen Schlagworte" — dann greift der
 * Rückfall auf \Seen (das bisherige, bewährte Verhalten). So läuft das
 * Projekt unverändert auch bei anderen Vermietern/IMAP-Servern, die keine
 * eigenen Schlagworte erlauben.
 *
 * Wird bei JEDER Verbindung neu geprüft: fetchNewEmails() und
 * markEmailsSeen() bauen je eine eigene IMAP-Sitzung auf (siehe
 * openConnection), es gibt also keinen gemeinsamen, zwischengespeicherten
 * Zustand, der veralten könnte.
 */
function supportsCustomKeywords(client: ImapFlow): boolean {
  const mailbox = client.mailbox;
  return mailbox !== false && (mailbox.permanentFlags?.has("\\*") ?? false);
}

/**
 * Wird geworfen, wenn der in IMAP_MAILBOX konfigurierte Ordner im Postfach
 * nicht existiert. Eigener Typ (statt eines generischen Error), damit
 * Aufrufer den Fall bei Bedarf gezielt erkennen koennen — siehe
 * getMailboxLockOrThrow().
 */
export class ImapMailboxNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImapMailboxNotFoundError";
  }
}

/**
 * Eine heruntergeladene, geparste Mail zusammen mit ihrer IMAP-UID.
 * Die UID wird gebraucht, damit der Aufrufer (pollOnce) die Mail erst NACH
 * erfolgreicher Persistierung als \Seen quittieren kann (siehe markEmailsSeen).
 */
export interface FetchedEmail {
  uid: number;
  mail: IncomingEmail;
}

export function filterToAlias(mails: IncomingEmail[], alias: string): IncomingEmail[] {
  const target = alias.toLowerCase();
  return mails.filter((mail) => mail.to.some((address) => address.toLowerCase() === target));
}

async function openConnection(): Promise<ImapFlow> {
  const env = getEnv();
  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: true,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD },
    logger: false,
  });
  await client.connect();
  return client;
}

/**
 * Oeffnet den konfigurierten Postfach-Ordner (IMAP_MAILBOX) und liefert dessen
 * Lock zurueck. Verwendet von fetchNewEmails() UND markEmailsSeen() — beide
 * MUESSEN denselben Ordner verwenden, sonst wuerde markEmailsSeen() Mails im
 * falschen Postfach quittieren wollen und sie blieben endlos "neu".
 *
 * Schlaegt getMailboxLock() fehl, ist der mit Abstand haeufigste Grund ein
 * Tippfehler im konfigurierten Ordnernamen (z. B. nach dem Einrichten einer
 * Fastmail-Regel in einen eigenen Ordner) — imapflow wirft dafuer aber nur
 * eine technische IMAP-Fehlermeldung ("NO [NONEXISTENT] ..."), die einem
 * Betreiber ohne IMAP-Kenntnisse nicht weiterhilft. Deshalb wird bei einem
 * Fehlschlag zusaetzlich die Ordnerliste des Postfachs abgefragt: fehlt der
 * konfigurierte Ordner darin tatsaechlich, wird eine lesbare deutsche
 * Fehlermeldung mit den TATSAECHLICH vorhandenen Ordnernamen geworfen, damit
 * der Betreiber den richtigen Namen abschreiben kann. Ist der Ordner
 * hingegen vorhanden (der Fehler hatte also eine andere Ursache, z. B. ein
 * Netzwerkproblem) oder laesst sich die Ordnerliste selbst nicht abrufen,
 * wird der urspruengliche Fehler unveraendert weitergereicht — er ist dann
 * informativer als eine geratene neue Meldung.
 */
async function getMailboxLockOrThrow(client: ImapFlow, mailbox: string): Promise<MailboxLockObject> {
  try {
    return await client.getMailboxLock(mailbox);
  } catch (originalError) {
    const folders = await client.list().catch(() => null);
    const mailboxExists = folders?.some((folder) => folder.path === mailbox) ?? true;
    if (!mailboxExists) {
      const available =
        folders && folders.length > 0
          ? folders.map((folder) => folder.path).join(", ")
          : "(keine Ordner gefunden)";
      throw new ImapMailboxNotFoundError(
        `Der konfigurierte IMAP-Ordner "${mailbox}" (Umgebungsvariable IMAP_MAILBOX) wurde in ` +
          `diesem Postfach nicht gefunden. Verfügbare Ordner: ${available}. Bitte IMAP_MAILBOX ` +
          `in der .env auf einen dieser Namen setzen (Groß-/Kleinschreibung beachten).`,
      );
    }
    throw originalError;
  }
}

/**
 * Holt neue Mails vom IMAP-Postfach, OHNE sie als verarbeitet zu markieren.
 *
 * Das Markieren ist bewusst NICHT Teil dieser Funktion: eine Mail darf erst
 * dann im Postfach als erledigt gelten, wenn sie beim Aufrufer tatsächlich
 * erfolgreich gespeichert wurde. Würde hier schon markiert, bevor pollOnce
 * die Mail in die Datenbank geschrieben hat, ginge eine Mail bei jedem
 * Speicherfehler (z. B. ein kaputter Anhang) stillschweigend verloren:
 * markiert, nie gespeichert, beim nächsten Poll nicht mehr geholt. Der
 * Aufrufer muss stattdessen nach erfolgreicher Verarbeitung explizit
 * markEmailsSeen() mit den UIDs der erfolgreich verarbeiteten Mails
 * aufrufen.
 *
 * WICHTIG — Verarbeitungsmerkmal: Frühere Versionen nutzten den
 * Gelesen-Status (\Seen) als Merkmal dafür, ob eine Mail noch zu verarbeiten
 * ist ({ seen: false, ... }). Das ist fragil, weil \Seen nicht diesem Tool
 * gehört: öffnet der Vermieter eine Mieter-Mail in seinem Mailclient, bevor
 * der Worker sie holt (Zeitfenster: das Poll-Intervall), markiert das sie
 * bereits als gelesen — der Worker fand sie dann nie in seiner Suche und
 * überging sie dauerhaft. Genau das ist im Live-Test passiert.
 *
 * Erlaubt der Server eigene Schlagworte (siehe supportsCustomKeywords),
 * dient stattdessen ein eigenes IMAP-Schlagwort (PROCESSED_KEYWORD) als
 * Verarbeitungsmerkmal: die Suche verlangt "unKeyword" statt "seen: false".
 * \Seen bleibt davon unberührt — markEmailsSeen() setzt es weiterhin
 * zusätzlich, rein kosmetisch, damit vom Tool erledigte Mails dem Vermieter
 * nicht als ungelesen im Ordner liegen bleiben. Unterstützt der Server keine
 * eigenen Schlagworte, greift der bisherige, bewährte Rückfall auf \Seen.
 */
export async function fetchNewEmails(): Promise<FetchedEmail[]> {
  const env = getEnv();
  const client = await openConnection();

  // client.logout() steht in einem äußeren finally, das den gesamten Block ab
  // hier umschließt: schlägt bereits getMailboxLock() fehl (nach erfolgreichem
  // connect()), bliebe sonst eine offene IMAP-Sitzung zurück — bei einem
  // Worker, der alle 30 Sekunden pollt, summiert sich das. Der Lock selbst
  // wird weiterhin in einem eigenen, inneren finally freigegeben, damit
  // lock.release() nie aufgerufen wird, wenn der Lock nie erworben wurde.
  try {
    const fetched: FetchedEmail[] = [];
    const lock = await getMailboxLockOrThrow(client, env.IMAP_MAILBOX);
    try {
      // Die Alias-Einschränkung muss bereits Teil der IMAP-Suche sein, nicht erst
      // des nachgelagerten Filters: sonst würde die private Post des Nutzers
      // (dieser Account ist sein Fastmail-Postfach) mitheruntergeladen. Die
      // serverseitige TO/CC-SEARCH matcht laut RFC 3501 aber nur als Substring,
      // nicht exakt (z. B. Plus-Adressierung, Domain-Treffer, Zufallstreffer im
      // Display-Namen) — der Server kann also UIDs liefern, die den Alias nur
      // scheinbar treffen. Deshalb wird jede heruntergeladene Mail einzeln mit
      // filterToAlias geprüft; Substring-Kollisionen werden verworfen und
      // tauchen im Rückgabewert gar nicht erst auf — sie dürfen also auch
      // später nie als verarbeitet markiert werden.
      const alias = env.MAIL_ALIAS;
      const aliasFilter = { or: [{ to: alias }, { cc: alias }] };
      const usesCustomKeyword = supportsCustomKeywords(client);
      announceCapabilityOnce(usesCustomKeyword);

      // Die zeitliche Untergrenze (IMAP_LOOKBACK_DAYS) gilt NUR im
      // Schlagwort-Pfad: genau dort entfällt der Gelesen-Filter, der bislang
      // implizit auch alten, nie geöffneten Bestand fernhielt. Ohne diese
      // Grenze würde der allererste Lauf gegen einen gewachsenen Ordner JEDE
      // jemals an den Alias gegangene Mail als neu ansehen. Im Rückfall-Pfad
      // bleibt { seen: false } weiterhin allein für dieses Verhalten
      // zuständig — unverändert gegenüber vorher, keine neue Einschränkung
      // für Betreiber ohne Schlagwort-Unterstützung.
      const searchQuery = usesCustomKeyword
        ? {
            unKeyword: PROCESSED_KEYWORD,
            since: new Date(Date.now() - env.IMAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
            ...aliasFilter,
          }
        : { seen: false, ...aliasFilter };

      const uids = (await client.search(searchQuery, { uid: true })) || [];
      for (const uid of uids) {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        const chunks: Buffer[] = [];
        for await (const chunk of content) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const mail = await parseRawEmail(Buffer.concat(chunks));
        if (filterToAlias([mail], alias).length > 0) {
          fetched.push({ uid, mail });
        }
      }
    } finally {
      lock.release();
    }

    return fetched;
  } finally {
    await client.logout();
  }
}

/**
 * Markiert die übergebenen UIDs im IMAP-Postfach als verarbeitet. Wird vom
 * Aufrufer erst NACH erfolgreicher Persistierung der jeweiligen Mail
 * aufgerufen (siehe fetchNewEmails). Bei leerer Liste wird gar keine
 * Verbindung aufgebaut.
 *
 * Erlaubt der Server eigene Schlagworte, wird zusätzlich zu \Seen das
 * Schlagwort PROCESSED_KEYWORD gesetzt — DAS ist ab jetzt das für
 * fetchNewEmails() maßgebliche Verarbeitungsmerkmal (siehe dort). \Seen wird
 * trotzdem mitgesetzt: rein kosmetisch, damit vom Tool erledigte Mails dem
 * Vermieter nicht als ungelesen im Ordner liegen bleiben — ein versehentliches
 * erneutes "Als ungelesen markieren" im Mailclient hat dann keinen Einfluss
 * mehr darauf, ob die Mail nochmal verarbeitet wird. Unterstützt der Server
 * keine eigenen Schlagworte, bleibt es beim bisherigen alleinigen \Seen.
 */
export async function markEmailsSeen(uids: number[]): Promise<void> {
  if (uids.length === 0) return;

  const env = getEnv();
  const client = await openConnection();
  // Gleiche Absicherung wie in fetchNewEmails(): client.logout() im äußeren
  // finally, damit ein fehlschlagender Lock-Erwerb nach erfolgreichem
  // connect() keine offene Verbindung hinterlässt.
  try {
    // MUSS denselben Ordner verwenden wie fetchNewEmails() (env.IMAP_MAILBOX) —
    // sonst quittiert diese Funktion Mails im falschen Postfach, und sie
    // würden bei jedem Poll erneut als "neu" geholt.
    const lock = await getMailboxLockOrThrow(client, env.IMAP_MAILBOX);
    try {
      const usesCustomKeyword = supportsCustomKeywords(client);
      announceCapabilityOnce(usesCustomKeyword);
      const flags = usesCustomKeyword ? [PROCESSED_KEYWORD, "\\Seen"] : ["\\Seen"];
      await client.messageFlagsAdd(uids, flags, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
