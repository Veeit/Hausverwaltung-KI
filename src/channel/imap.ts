import { ImapFlow } from "imapflow";
import { getEnv } from "@/env";
import { parseRawEmail } from "@/channel/parse";
import type { IncomingEmail } from "@/channel/types";

export function filterToAlias(mails: IncomingEmail[], alias: string): IncomingEmail[] {
  const target = alias.toLowerCase();
  return mails.filter((mail) => mail.to.some((address) => address.toLowerCase() === target));
}

export async function fetchNewEmails(): Promise<IncomingEmail[]> {
  const env = getEnv();
  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: true,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD },
    logger: false,
  });
  await client.connect();

  const parsed: IncomingEmail[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Die Alias-Einschränkung muss bereits Teil der IMAP-Suche sein, nicht erst
    // des nachgelagerten Filters: sonst würde die private Post des Nutzers
    // (dieser Account ist sein Fastmail-Postfach) mitheruntergeladen und
    // durch messageFlagsAdd unwiderruflich als \Seen markiert. Die serverseitige
    // TO/CC-SEARCH matcht laut RFC 3501 aber nur als Substring, nicht exakt
    // (z. B. Plus-Adressierung, Domain-Treffer, Zufallstreffer im Display-Namen)
    // — der Server kann also UIDs liefern, die den Alias nur scheinbar treffen.
    // Deshalb wird jede heruntergeladene Mail einzeln mit filterToAlias geprüft
    // und nur bei echtem Treffer als \Seen markiert; Substring-Kollisionen werden
    // verworfen und bleiben ungelesen, damit sie beim nächsten Poll erneut
    // geladen und ggf. korrekt zugeordnet werden können.
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
        parsed.push(mail);
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return parsed;
}
