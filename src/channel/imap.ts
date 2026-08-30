import { ImapFlow, type MailboxLockObject } from "imapflow";
import { getEnv } from "@/env";
import { parseRawEmail } from "@/channel/parse";
import type { IncomingEmail } from "@/channel/types";

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
 * Holt neue Mails vom IMAP-Postfach, OHNE sie als gelesen zu markieren.
 *
 * Das Markieren als \Seen ist bewusst NICHT Teil dieser Funktion: eine Mail
 * darf erst dann im Postfach als erledigt gelten, wenn sie beim Aufrufer
 * tatsächlich erfolgreich gespeichert wurde. Würde hier schon markiert,
 * bevor pollOnce die Mail in die Datenbank geschrieben hat, ginge eine Mail
 * bei jedem Speicherfehler (z. B. ein kaputter Anhang) stillschweigend
 * verloren: gelesen markiert, nie gespeichert, beim nächsten Poll nicht mehr
 * geholt. Der Aufrufer muss stattdessen nach erfolgreicher Verarbeitung
 * explizit markEmailsSeen() mit den UIDs der erfolgreich verarbeiteten
 * Mails aufrufen.
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
      // später nie als \Seen markiert werden.
      const alias = env.MAIL_ALIAS;
      const uids =
        (await client.search(
          { seen: false, or: [{ to: alias }, { cc: alias }] },
          { uid: true },
        )) || [];
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
 * Markiert die übergebenen UIDs im IMAP-Postfach als \Seen. Wird vom
 * Aufrufer erst NACH erfolgreicher Persistierung der jeweiligen Mail
 * aufgerufen (siehe fetchNewEmails). Bei leerer Liste wird gar keine
 * Verbindung aufgebaut.
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
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
