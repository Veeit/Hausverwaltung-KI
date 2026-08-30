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
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids) {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      parsed.push(await parseRawEmail(Buffer.concat(chunks)));
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return filterToAlias(parsed, env.MAIL_ALIAS);
}
