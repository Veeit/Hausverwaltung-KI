import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { attachments, contractors, messages, tenants } from "@/db/schema";
import { getEnv } from "@/env";
import type { IncomingEmail } from "@/channel/types";
import { fetchNewEmails, markEmailsSeen, type FetchedEmail } from "@/channel/imap";
import { findOrCreateConversation, touchConversation } from "@/lib/conversations";
import { resolveAuthorizedTaggedTicketId } from "@/lib/ticketAccess";
import { isWorkerPaused } from "@/lib/rateLimit";
import { runAgentOnMessage, type AgentRunDeps } from "@/agent/run";

// Sichere Obergrenze für Dateinamen (Dateisystemgrenzen liegen typischerweise
// bei 255 Bytes pro Pfadsegment; 200 lässt Luft für Mehrbyte-Zeichen, die
// hier zwar durch die Allowlist ohnehin ausgeschlossen sind, aber als
// Sicherheitsabstand beibehalten werden). Ein zu langer Dateiname löst sonst
// ein unbehandeltes ENAMETOOLONG in fs.writeFileSync aus (siehe pollOnce).
const MAX_FILENAME_LENGTH = 200;
// Endungen jenseits dieser Länge gelten als entartet (z. B. ein Angriffsname
// ohne echten Punkt-Trenner) und werden beim Kürzen verworfen statt erhalten.
const MAX_EXTENSION_LENGTH = 20;

/**
 * Dateinamen auf [a-zA-Z0-9._-] reduzieren; alles andere wird '_'.
 * Degenerierte Ergebnisse ("", ".", "..") werden zu "_", damit path.join
 * niemals aus dem Message-Ordner ausbrechen kann.
 *
 * Zusätzlich wird auf MAX_FILENAME_LENGTH gekürzt, damit ein pathologisch
 * langer Dateiname nicht zu einem unbehandelten ENAMETOOLONG in
 * fs.writeFileSync führt — genau der Auslöser, der eine Mail beim
 * anschließenden Speicherfehler stumm verschwinden ließ. Die Dateiendung
 * bleibt beim Kürzen erhalten, damit die Datei später noch zugeordnet werden
 * kann (z. B. weiterhin als ".pdf" erkennbar ist).
 */
function sanitizeFilename(filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (sanitized === "" || sanitized === "." || sanitized === "..") return "_";
  if (sanitized.length <= MAX_FILENAME_LENGTH) return sanitized;

  const ext = path.extname(sanitized);
  const safeExt = ext.length > 0 && ext.length <= MAX_EXTENSION_LENGTH ? ext : "";
  const base = safeExt ? sanitized.slice(0, sanitized.length - safeExt.length) : sanitized;
  const truncatedBase = base.slice(0, MAX_FILENAME_LENGTH - safeExt.length);
  const truncated = `${truncatedBase}${safeExt}`;
  return truncated === "" || truncated === "." || truncated === ".." ? "_" : truncated;
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

  // 2. Rollen-Klassifikation über die Absenderadresse (DB speichert lowercase,
  //    getrimmt). .trim() wie in src/lib/recipients.ts: ohne diesen Trim würde
  //    eine Absenderadresse mit Leerzeichen-Umgebung fälschlich als
  //    unbekannter Absender (role "unknown") eingestuft, obwohl Mieter oder
  //    Handwerker mit genau dieser (getrimmten) Adresse hinterlegt sind.
  const from = mail.from.trim().toLowerCase();
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
  // Betreff-Tag [HV-n] nur übernehmen, wenn der Absender tatsächlich zu diesem
  // Vorgang gehört (siehe resolveAuthorizedTaggedTicketId) — sonst könnte jeder
  // Mieter/Handwerker über einen erratenen oder alten Tag fremde Vorgänge lesen
  // und via update_ticket verändern (Critical-Befund aus dem Abschluss-Review).
  const ticketId = resolveAuthorizedTaggedTicketId({
    subject: mail.subject,
    role,
    fromEmail: from,
    conversationId,
  });

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

/**
 * Setzt Nachrichten, die beim letzten Lauf in 'processing' hängen geblieben
 * sind, wieder auf 'pending' zurück. runAgentOnMessage() setzt den Status auf
 * 'processing', BEVOR der Modell-Lauf beginnt — stirbt der Prozess währenddessen
 * (das größte Zeitfenster im System), bliebe die Nachricht ohne diesen Reset
 * für immer in 'processing' hängen: kein automatischer Retry (processPendingMessages
 * wählt nur 'pending') und keine Sichtbarkeit im Dashboard (die Übersicht zeigt
 * nur 'failed'). Wird beim Start des Worker-Prozesses aufgerufen (src/worker/index.ts),
 * nicht bei jedem Poll-Durchlauf — nach dem Start läuft jede Verarbeitung wieder
 * über den normalen 'processing'-Zwischenstatus, der dann korrekt für die Dauer
 * eines einzelnen, laufenden Agent-Aufrufs steht.
 */
export function resetStuckProcessingMessages(): number {
  const db = getDb();
  const result = db
    .update(messages)
    .set({ processingStatus: "pending" })
    .where(eq(messages.processingStatus, "processing"))
    .run();
  return result.changes;
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
  markSeen?: typeof markEmailsSeen;
  agent?: AgentRunDeps;
}): Promise<void> {
  if (isWorkerPaused()) return;

  const fetchFn = deps?.fetch ?? fetchNewEmails;
  const markSeenFn = deps?.markSeen ?? markEmailsSeen;
  const fetched: FetchedEmail[] = await fetchFn();

  // Jede Mail wird EINZELN abgesichert: eine eingehende Mail darf nie
  // stumm verloren gehen. Scheitert das Speichern einer Mail (z. B. ein
  // kaputter Anhang), darf das weder die übrigen Mails desselben Batches
  // mitreißen noch dazu führen, dass die gescheiterte Mail als gelesen
  // markiert wird — sie bleibt ungelesen und wird beim nächsten Poll erneut
  // versucht. Das kann bei einer dauerhaft kaputten Mail zu wiederholten
  // Versuchen führen; für den PoC ist das akzeptabel und dem stillen
  // Verlust klar vorzuziehen. Der Fehler wird daher lautstark geloggt (UID +
  // Absender), damit ein solcher Fall im Log auffällt und die Mail im
  // Postfach wiedergefunden werden kann.
  const seenUids: number[] = [];
  for (const { uid, mail } of fetched) {
    try {
      await ingestEmail(mail);
      seenUids.push(uid);
    } catch (err) {
      console.error(
        `[worker] Mail konnte nicht gespeichert werden — bleibt ungelesen und wird erneut versucht ` +
          `(uid=${uid}, from=${mail.from}, subject=${JSON.stringify(mail.subject)}):`,
        err,
      );
    }
  }

  // Das Quittieren wird bewusst eigens abgesichert: Scheitert es (z.B. durch
  // einen abgebrochenen IMAP-Verbindungsaufbau), sollen die bereits sicher in
  // der DB gespeicherten Nachrichten TROTZDEM verarbeitet werden — sie stehen
  // ja schon fest in der DB, unabhängig davon, ob das Postfach sie noch als
  // ungelesen führt. Kein Datenrisiko: nicht quittierte Mails werden beim
  // nächsten Poll erneut geholt und über die Message-ID-Deduplizierung in
  // ingestEmail() automatisch übersprungen.
  try {
    await markSeenFn(seenUids);
  } catch (err) {
    console.error(
      `[worker] Quittieren als gelesen fehlgeschlagen (uids=${JSON.stringify(seenUids)}) — ` +
        `werden beim nächsten Poll erneut abgeholt und über die Message-ID dedupliziert:`,
      err,
    );
  }
  await processPendingMessages(deps?.agent);
}
