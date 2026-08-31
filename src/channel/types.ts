export interface IncomingAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IncomingEmail {
  messageId: string; // Message-ID-Header; falls fehlt: `generated-${Date.now()}-${Math.random()}` beim Parsen
  from: string; // lowercase Adresse
  to: string[]; // alle To+Cc-Adressen, lowercase
  subject: string; // "" falls fehlt
  text: string; // Plaintext; falls nur HTML: Tags rudimentär strippen
  date: Date;
  attachments: IncomingAttachment[];
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
}

/**
 * Die Kanal-Abstraktion aus Spec §3: Ein- und Ausgang liegen hinter diesem
 * schmalen Interface, damit später WhatsApp oder SMS andocken können, ohne
 * die Agent-Logik anzufassen.
 *
 * Seit dem Task-10-Fix gegen stillen Mail-Verlust liefert `fetchNewEmails`
 * (Task 6) nicht mehr `IncomingEmail[]` direkt, sondern
 * `FetchedEmail[]` (`{ uid, mail }`) — das Markieren als gelesen (`\Seen`)
 * passiert erst NACH erfolgreicher Persistierung durch den Aufrufer, über
 * die separate Funktion `markEmailsSeen`. `fetchNewEmails` erfüllt `Channel`
 * also nicht mehr strukturell 1:1; ein Adapter wäre nötig
 * (`fetch: async () => (await fetchNewEmails()).map((f) => f.mail)`), wenn
 * die E-Mail-Implementierung tatsächlich hinter diesem Interface laufen
 * soll. `sendSmtp` (Step 7 dieses Tasks) erfüllt weiterhin `Channel["send"]`
 * unverändert.
 *
 * Ein zweiter Kanal implementiert dasselbe Interface und wird an denselben
 * Stellen injiziert, an denen `pollOnce` und `sendAndLogEmail` heute ihre
 * Default-Parameter haben.
 */
export interface Channel {
  fetch: () => Promise<IncomingEmail[]>;
  send: (mail: OutgoingEmail) => Promise<void>;
}
