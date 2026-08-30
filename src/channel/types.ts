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
 * `fetchNewEmails` (Task 6) und `sendSmtp` (Step 7 dieses Tasks) erfüllen es
 * strukturell — die E-Mail-Implementierung ist also bereits ein `Channel`:
 *
 *   const emailChannel: Channel = { fetch: fetchNewEmails, send: sendSmtp };
 *
 * Ein zweiter Kanal implementiert dasselbe Interface und wird an denselben
 * Stellen injiziert, an denen `pollOnce` und `sendAndLogEmail` heute ihre
 * Default-Parameter haben.
 */
export interface Channel {
  fetch: () => Promise<IncomingEmail[]>;
  send: (mail: OutgoingEmail) => Promise<void>;
}
