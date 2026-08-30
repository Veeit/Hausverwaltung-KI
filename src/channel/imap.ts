import { ImapFlow } from "imapflow";
import { getEnv } from "@/env";
import { parseRawEmail } from "@/channel/parse";
import type { IncomingEmail } from "@/channel/types";

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

  const fetched: FetchedEmail[] = [];
  const lock = await client.getMailboxLock("INBOX");
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
    await client.logout();
  }

  return fetched;
}

/**
 * Markiert die übergebenen UIDs im IMAP-Postfach als \Seen. Wird vom
 * Aufrufer erst NACH erfolgreicher Persistierung der jeweiligen Mail
 * aufgerufen (siehe fetchNewEmails). Bei leerer Liste wird gar keine
 * Verbindung aufgebaut.
 */
export async function markEmailsSeen(uids: number[]): Promise<void> {
  if (uids.length === 0) return;

  const client = await openConnection();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}
