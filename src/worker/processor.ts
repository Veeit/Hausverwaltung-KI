import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { attachments, contractors, messages, tenants, tickets } from "@/db/schema";
import { getEnv } from "@/env";
import type { IncomingEmail } from "@/channel/types";
import { fetchNewEmails } from "@/channel/imap";
import { findOrCreateConversation, touchConversation } from "@/lib/conversations";
import { extractTicketId } from "@/lib/subject";
import { isWorkerPaused } from "@/lib/rateLimit";
import { runAgentOnMessage, type AgentRunDeps } from "@/agent/run";

/**
 * Dateinamen auf [a-zA-Z0-9._-] reduzieren; alles andere wird '_'.
 * Degenerierte Ergebnisse ("", ".", "..") werden zu "_", damit path.join
 * niemals aus dem Message-Ordner ausbrechen kann.
 */
function sanitizeFilename(filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (sanitized === "" || sanitized === "." || sanitized === "..") return "_";
  return sanitized;
}

export async function ingestEmail(mail: IncomingEmail): Promise<number | null> {
  const db = getDb();
  const env = getEnv();

  // 1. Dedupe über den Message-ID-Header (idempotente IMAP-Verarbeitung)
  const existing = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.imapMessageId, mail.messageId))
    .get();
  if (existing) return null;

  // 2. Rollen-Klassifikation über die Absenderadresse (DB speichert lowercase)
  const from = mail.from.toLowerCase();
  const tenant = db.select().from(tenants).where(eq(tenants.email, from)).get();
  const contractor = tenant
    ? undefined
    : db.select().from(contractors).where(eq(contractors.email, from)).get();

  let role: "tenant" | "contractor" | "unknown";
  let counterpartType: "tenant" | "contractor" | "unknown";
  let counterpartId: number | null;
  if (tenant) {
    role = "tenant";
    counterpartType = "tenant";
    counterpartId = tenant.id;
  } else if (contractor) {
    role = "contractor";
    counterpartType = "contractor";
    counterpartId = contractor.id;
  } else {
    role = "unknown";
    counterpartType = "unknown";
    counterpartId = null;
  }

  // 3. Conversation finden/anlegen; Ticket-Zuordnung über [HV-id]-Tag im Betreff
  const conversationId = findOrCreateConversation({
    email: from,
    counterpartType,
    counterpartId,
    subject: mail.subject,
  });
  const taggedTicketId = extractTicketId(mail.subject);
  let ticketId: number | null = null;
  if (taggedTicketId !== null) {
    const ticket = db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.id, taggedTicketId))
      .get();
    ticketId = ticket ? ticket.id : null;
  }

  // 4. Message persistieren (Spec: erst persistieren, dann verarbeiten).
  //    Unbekannte Absender werden nie beantwortet → direkt 'done'.
  const inserted = db
    .insert(messages)
    .values({
      conversationId,
      ticketId,
      direction: "inbound",
      role,
      fromEmail: from,
      toEmail: env.MAIL_ALIAS.toLowerCase(),
      subject: mail.subject,
      body: mail.text,
      imapMessageId: mail.messageId,
      processingStatus: role === "unknown" ? "done" : "pending",
    })
    .returning({ id: messages.id })
    .get();
  const messageId = inserted.id;

  // 5. Anhänge sanitisiert auf Disk ablegen + attachments-Rows (filePath absolut)
  if (mail.attachments.length > 0) {
    const messageDir = path.resolve(env.ATTACHMENTS_DIR, String(messageId));
    fs.mkdirSync(messageDir, { recursive: true });
    for (const att of mail.attachments) {
      const filePath = path.join(messageDir, sanitizeFilename(att.filename));
      fs.writeFileSync(filePath, att.content);
      db.insert(attachments)
        .values({
          messageId,
          filename: att.filename,
          mimeType: att.mimeType,
          filePath,
          size: att.content.length,
        })
        .run();
    }
  }

  // 6. Conversation aktualisieren
  touchConversation(conversationId);
  return messageId;
}

export async function processPendingMessages(deps?: AgentRunDeps): Promise<void> {
  const db = getDb();
  const pending = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "inbound"),
        eq(messages.processingStatus, "pending"),
        lt(messages.processingAttempts, 3),
        ne(messages.role, "unknown"),
      ),
    )
    .orderBy(asc(messages.id))
    .all();

  for (const row of pending) {
    await runAgentOnMessage(row.id, deps);
  }
}

export async function pollOnce(deps?: {
  fetch?: typeof fetchNewEmails;
  agent?: AgentRunDeps;
}): Promise<void> {
  if (isWorkerPaused()) return;

  const fetchFn = deps?.fetch ?? fetchNewEmails;
  const mails = await fetchFn();
  for (const mail of mails) {
    await ingestEmail(mail);
  }
  await processPendingMessages(deps?.agent);
}
