import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { and, desc, eq, isNotNull, ne, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  approvals,
  attachments,
  contractors,
  conversations,
  messages,
  properties,
  tenants,
  tickets,
  type ContractorRow,
  type MessageRow,
  type TenantRow,
  type TicketRow,
} from "@/db/schema";
import { resolveAuthorizedTaggedTicketId } from "@/lib/ticketAccess";
import { roleLabel } from "@/lib/format";

export type AgentKind = "tenant_message" | "contractor_message" | "landlord_answer";

export interface TriggerInfo {
  message: MessageRow;
  kind: AgentKind;
  tenant: (TenantRow & { propertyAddress: string }) | null;
  contractor: ContractorRow | null;
  ticket: TicketRow | null;
}

// Die einzigen von Claude unterstützten Bild-MIME-Typen (siehe API-Doku); alle anderen
// image/*-Typen (z.B. image/heic von iPhone-Fotos oder image/svg+xml) werden abgelehnt.
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function loadTenantWithProperty(tenantId: number): (TenantRow & { propertyAddress: string }) | null {
  const db = getDb();
  const row = db
    .select({ tenant: tenants, propertyAddress: properties.address })
    .from(tenants)
    .innerJoin(properties, eq(tenants.propertyId, properties.id))
    .where(eq(tenants.id, tenantId))
    .get();
  return row ? { ...row.tenant, propertyAddress: row.propertyAddress } : null;
}

function loadTenantByEmail(email: string): (TenantRow & { propertyAddress: string }) | null {
  const db = getDb();
  const row = db
    .select({ tenant: tenants, propertyAddress: properties.address })
    .from(tenants)
    .innerJoin(properties, eq(tenants.propertyId, properties.id))
    .where(eq(tenants.email, email.toLowerCase()))
    .get();
  return row ? { ...row.tenant, propertyAddress: row.propertyAddress } : null;
}

/**
 * Rückfall für einen Handwerker, der ohne (oder mit fremdem, verworfenem)
 * Betreff-Tag schreibt: jüngstes nicht-erledigtes Ticket, für das GENAU dieser
 * Handwerker tatsächlich beauftragt ist — spiegelt exakt die
 * Berechtigungsprüfung aus resolveAuthorizedTaggedTicketId (tickets.contractorId
 * ODER eine genehmigte approvals-Zeile). Ohne diese Einschränkung könnte der
 * Rückfall die Berechtigungsprüfung aus Punkt 1 unterlaufen, indem er einfach
 * das jüngste offene Ticket IRGENDEINES Mieters findet.
 */
function findLatestOpenTicketForContractor(contractorId: number): TicketRow | null {
  const db = getDb();
  const row = db
    .select({ ticket: tickets })
    .from(tickets)
    .leftJoin(
      approvals,
      and(
        eq(approvals.ticketId, tickets.id),
        eq(approvals.contractorId, contractorId),
        eq(approvals.status, "genehmigt"),
      ),
    )
    .where(
      and(
        ne(tickets.status, "erledigt"),
        or(eq(tickets.contractorId, contractorId), isNotNull(approvals.id)),
      ),
    )
    .orderBy(desc(tickets.id))
    .limit(1)
    .get();
  return row ? row.ticket : null;
}

export function loadTriggerInfo(messageId: number): TriggerInfo {
  const db = getDb();
  const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!message) throw new Error(`Message ${messageId} nicht gefunden`);

  let kind: AgentKind;
  if (message.role === "tenant") kind = "tenant_message";
  else if (message.role === "contractor") kind = "contractor_message";
  else if (message.role === "landlord") kind = "landlord_answer";
  else throw new Error(`Keine Agent-Verarbeitung für Rolle "${message.role}"`);

  // Handwerker früh auflösen: wird sowohl von resolveAuthorizedTaggedTicketId
  // (Betreff-Tag-Berechtigungsprüfung) als auch vom Rückfall auf das jüngste,
  // diesem Handwerker zugeordnete offene Ticket gebraucht.
  let contractor: ContractorRow | null = null;
  if (kind === "contractor_message") {
    contractor =
      db.select().from(contractors).where(eq(contractors.email, message.fromEmail.toLowerCase())).get() ?? null;
  }

  // Ticket auflösen: message.ticketId → Betreff-Tag → (bei Mieter) jüngstes
  // nicht-erledigtes Ticket der Conversation → (bei Handwerker) jüngstes
  // nicht-erledigtes Ticket, für das dieser Handwerker beauftragt ist.
  let ticket: TicketRow | null = null;
  if (message.ticketId != null) {
    ticket = db.select().from(tickets).where(eq(tickets.id, message.ticketId)).get() ?? null;
  }
  if (!ticket) {
    // Wie beim Ingest (src/worker/processor.ts): der Betreff-Tag wird nur
    // übernommen, wenn der Absender tatsächlich zu diesem Vorgang gehört.
    const authorizedTaggedId = resolveAuthorizedTaggedTicketId({
      subject: message.subject,
      role: message.role,
      fromEmail: message.fromEmail,
      conversationId: message.conversationId,
    });
    if (authorizedTaggedId != null) {
      ticket = db.select().from(tickets).where(eq(tickets.id, authorizedTaggedId)).get() ?? null;
    }
  }
  if (!ticket && message.role === "tenant") {
    ticket =
      db
        .select()
        .from(tickets)
        .where(and(eq(tickets.conversationId, message.conversationId), ne(tickets.status, "erledigt")))
        .orderBy(desc(tickets.id))
        .limit(1)
        .get() ?? null;
  }
  // Rückfall für einen Handwerker, der eine FRISCHE Mail schreibt statt auf
  // die Ticket-Mail zu antworten (kein bzw. verworfener Betreff-Tag): ohne
  // diesen Fallback gäbe es weder Ticket noch Mieter im Kontext, und alle
  // sinnvollen Werkzeuge (send_reply, update_ticket) lieferten nur FEHLER.
  if (!ticket && message.role === "contractor" && contractor) {
    ticket = findLatestOpenTicketForContractor(contractor.id);
  }

  let tenant: (TenantRow & { propertyAddress: string }) | null = null;

  if (kind === "tenant_message") {
    tenant = loadTenantByEmail(message.fromEmail);
  } else if (kind === "contractor_message") {
    if (ticket) tenant = loadTenantWithProperty(ticket.tenantId);
  } else {
    // landlord_answer: Mieter über das Ticket, sonst über die Conversation-Zuordnung
    if (ticket) {
      tenant = loadTenantWithProperty(ticket.tenantId);
    } else {
      const conv = db.select().from(conversations).where(eq(conversations.id, message.conversationId)).get();
      if (conv && conv.counterpartType === "tenant" && conv.counterpartId != null) {
        tenant = loadTenantWithProperty(conv.counterpartId);
      }
    }
  }

  if (!contractor && ticket?.contractorId != null) {
    contractor = db.select().from(contractors).where(eq(contractors.id, ticket.contractorId)).get() ?? null;
  }

  return { message, kind, tenant, contractor, ticket };
}

export function buildTranscript(conversationId: number, excludeMessageId?: number, limit: number = 30): string {
  const db = getDb();
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .all()
    .filter((m) => m.id !== excludeMessageId)
    .slice(0, limit)
    .reverse();
  return rows.map((m) => `### ${m.createdAt} — ${roleLabel(m.role)} (${m.fromEmail}):\n${m.body}\n`).join("\n");
}

export function buildUserContent(trigger: TriggerInfo): Anthropic.Beta.BetaContentBlockParam[] {
  const db = getDb();
  const { message } = trigger;
  const transcript = buildTranscript(message.conversationId, message.id);
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: `## Bisheriger Verlauf\n${transcript}\n\n## NEUE NACHRICHT (${roleLabel(message.role)}, ${message.createdAt})\nBetreff: ${message.subject ?? ""}\n\n${message.body}`,
    },
  ];
  const files = db.select().from(attachments).where(eq(attachments.messageId, message.id)).all();
  for (const file of files) {
    // Claude unterstützt nur diese vier Bild-MIME-Typen; alles andere (z.B. HEIC-Fotos
    // von iPhones oder SVGs) würde die API mit HTTP 400 scheitern lassen, obwohl es mit
    // "image/" beginnt. Solche Anhänge werden wie Nicht-Bilder übersprungen.
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.mimeType)) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: readFileSync(file.filePath).toString("base64"),
      },
    });
  }
  return blocks;
}
