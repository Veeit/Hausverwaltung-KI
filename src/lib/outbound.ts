import { eq } from "drizzle-orm";
import { getEnv } from "@/env";
import { getDb } from "@/db/client";
import { messages } from "@/db/schema";
import { assertAllowedRecipient } from "@/lib/recipients";
import { assertRateLimit } from "@/lib/rateLimit";
import { touchConversation } from "@/lib/conversations";
import { sendSmtp } from "@/channel/smtp";

export interface SendParams {
  to: string;
  subject: string;
  text: string;
  role: "ai" | "landlord";
  conversationId: number;
  ticketId?: number | null;
}

export async function sendAndLogEmail(
  params: SendParams,
  send: typeof sendSmtp = sendSmtp,
): Promise<number> {
  assertAllowedRecipient(params.to);
  assertRateLimit();

  const db = getDb();
  const env = getEnv();
  const inserted = db
    .insert(messages)
    .values({
      conversationId: params.conversationId,
      ticketId: params.ticketId ?? null,
      direction: "outbound",
      role: params.role,
      fromEmail: env.MAIL_ALIAS,
      toEmail: params.to,
      subject: params.subject,
      body: params.text,
      processingStatus: "sending",
    })
    .run();
  const messageId = Number(inserted.lastInsertRowid);

  try {
    await send({ to: params.to, subject: params.subject, text: params.text });
    db.update(messages)
      .set({ processingStatus: "done" })
      .where(eq(messages.id, messageId))
      .run();
    touchConversation(params.conversationId);
    return messageId;
  } catch (err) {
    db.update(messages)
      .set({ processingStatus: "failed", processingError: String(err) })
      .where(eq(messages.id, messageId))
      .run();
    throw err;
  }
}
