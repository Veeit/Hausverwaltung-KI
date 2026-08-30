import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, contractors, escalations, messages, tickets } from "@/db/schema";
import {
  InvalidTransitionError,
  TICKET_TYPES,
  URGENCIES,
  canTransition,
  createTicket,
  transitionTicket,
  type TicketStatus,
} from "@/lib/tickets";
import { ensureTag } from "@/lib/subject";
import { searchDocuments } from "@/lib/documents";
import { sendAndLogEmail } from "@/lib/outbound";
import { findOrCreateConversation } from "@/lib/conversations";
import { RecipientNotAllowedError } from "@/lib/recipients";
import { RateLimitExceededError } from "@/lib/rateLimit";
import type { sendSmtp } from "@/channel/smtp";

// Strukturell identische Kopie von AgentKind aus src/agent/context.ts (Task 9).
// Bewusst NICHT exportiert: die offizielle Definition liegt in context.ts;
// dieser Task muss aber ohne context.ts kompilieren.
type AgentKind = "tenant_message" | "contractor_message" | "landlord_answer";

export interface AgentToolContext {
  kind: AgentKind;
  conversationId: number;
  triggerMessageId: number;
  tenant: { id: number; name: string; email: string } | null;
  contractor: { id: number; name: string; email: string } | null;
  ticketId: number | null; // mutable: wird bei Ticket-Anlage gesetzt
  repliedToTenant: boolean; // mutable: send_reply(mieter) setzt true
  sendFn?: typeof sendSmtp; // Test-Injektion, an sendAndLogEmail durchgereicht
}

export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (input: unknown) => Promise<string>;
}

const searchDocumentsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Deutsche Suchbegriffe für die Volltextsuche, z.B. 'Ruhezeiten Hausordnung' oder 'Kaution Rückzahlung'.",
    ),
});

const updateTicketSchema = z.object({
  type: z
    .enum(TICKET_TYPES)
    .optional()
    .describe(
      "Vorgangstyp: 'reparatur', 'frage' oder 'sonstiges'. PFLICHT beim Anlegen eines neuen Tickets.",
    ),
  title: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Kurzer Titel des Vorgangs, z.B. 'Türschloss klemmt'. PFLICHT beim Anlegen eines neuen Tickets.",
    ),
  status: z
    .enum(["infosammlung", "terminiert", "erledigt"])
    .optional()
    .describe(
      "Neuer Status: 'infosammlung' sobald du Rückfragen stellst, 'terminiert' nach beidseitig bestätigtem Termin (dann auch appointmentAt setzen), 'erledigt' nach Abschluss. Die Status wartet_auf_genehmigung und eskaliert setzen request_approval bzw. ask_landlord automatisch.",
    ),
  summary: z
    .string()
    .optional()
    .describe("Aktuelle Zusammenfassung des Problems in 1-3 Sätzen."),
  urgency: z
    .enum(URGENCIES)
    .optional()
    .describe("Dringlichkeit: 'niedrig', 'mittel', 'hoch' oder 'notfall'."),
  setInfo: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .describe("Schlüssel in snake_case, z.B. 'seit_wann' oder 'terminfenster'."),
        value: z.string().describe("Der gesammelte Wert als Freitext."),
      }),
    )
    .optional()
    .describe(
      "Gesammelte Infos als Schlüssel-Wert-Paare; sie werden mit bereits gespeicherten Infos zusammengeführt (gleicher Schlüssel überschreibt den alten Wert).",
    ),
  appointmentAt: z
    .string()
    .optional()
    .describe(
      "Bestätigter Termin (Freitext oder ISO-Datum), nur zusammen mit status 'terminiert' sinnvoll.",
    ),
});

const requestApprovalSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "Zusammenfassung des Problems und der vorgeschlagenen Maßnahme für den Vermieter.",
    ),
  contractorId: z
    .number()
    .int()
    .describe(
      "Id des vorgeschlagenen Handwerkers aus der Handwerkerliste im Systemprompt; wähle das passende Gewerk.",
    ),
  emailSubject: z
    .string()
    .min(1)
    .describe("Betreff des Mail-Entwurfs an den Handwerker."),
  emailBody: z
    .string()
    .min(1)
    .describe(
      "Vollständiger Mail-Entwurf an den Handwerker: Objektadresse, Problembeschreibung, Terminfenster des Mieters, Bitte um Terminvorschlag per Antwort auf diese Mail.",
    ),
  urgency: z
    .enum(URGENCIES)
    .optional()
    .describe("Dringlichkeit des Vorgangs, wird am Ticket gespeichert."),
});

const askLandlordSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe(
      "Konkrete Frage an den Vermieter, mit allem Kontext, den er zur Entscheidung braucht.",
    ),
});

const sendReplySchema = z.object({
  recipient: z
    .enum(["mieter", "handwerker"])
    .describe(
      "'mieter' für den Mieter des Vorgangs. 'handwerker' NUR zur Terminbestätigung, nachdem der Vermieter genehmigt hat (Ticket-Status handwerker_angefragt oder terminiert) — sonst wird der Versand abgelehnt. Die Empfängeradresse wird serverseitig aufgelöst, du gibst keine E-Mail-Adresse an.",
    ),
  subject: z
    .string()
    .min(1)
    .describe(
      "Betreff der E-Mail. Der Ticket-Tag [HV-n] wird automatisch ergänzt, nicht selbst anhängen.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "Vollständiger deutscher Mail-Text. Mieter siezen, Signatur 'Ihre Hausverwaltung (KI-Assistent)'.",
    ),
});

export function buildAgentTools(ctx: AgentToolContext): AgentToolSpec[] {
  return [
    {
      name: "search_documents",
      description:
        "Volltextsuche in den hinterlegten Dokumenten der Hausverwaltung (Mietverträge, Hausordnung usw.). Nutze dieses Tool ZUERST bei jeder Frage zum Mietverhältnis, bevor du antwortest; liefert es keine Fundstelle, nutze ask_landlord statt zu raten. Ergebnis: Trefferliste mit Dateiname und Textausschnitt oder 'Keine Treffer.'",
      inputSchema: searchDocumentsSchema,
      run: async (input) => {
        const args = searchDocumentsSchema.parse(input);
        const hits = searchDocuments(args.query);
        if (hits.length === 0) return "Keine Treffer.";
        return hits
          .map((h, i) => `${i + 1}. ${h.filename} (Dokument ${h.documentId}): ${h.snippet}`)
          .join("\n");
      },
    },
    {
      name: "update_ticket",
      description:
        "Legt einen Vorgang (Ticket) an oder aktualisiert ihn. Nutze es bei jeder neuen Reparaturmeldung SOFORT zum Anlegen: dann sind type und title Pflicht, das Ticket startet im Status 'neu'. Bei bestehendem Ticket aktualisiert es Felder, speichert gesammelte Infos über setInfo (z.B. seit_wann, terminfenster) und setzt erlaubte Status: 'infosammlung' (Rückfragen laufen), 'terminiert' (Termin bestätigt, appointmentAt mitliefern), 'erledigt' (abgeschlossen). Ungültige Statuswechsel werden mit FEHLER abgelehnt.",
      inputSchema: updateTicketSchema,
      run: async (input) => {
        const args = updateTicketSchema.parse(input);
        const db = getDb();
        let ticketId = ctx.ticketId;
        let created = false;
        if (ticketId === null) {
          if (!ctx.tenant) {
            return "FEHLER: Kein Mieter im Kontext — ein Ticket kann nur für einen bekannten Mieter angelegt werden.";
          }
          if (!args.type || !args.title) {
            return "FEHLER: Zum Anlegen eines neuen Tickets sind die Felder type und title erforderlich.";
          }
          ticketId = createTicket({
            tenantId: ctx.tenant.id,
            conversationId: ctx.conversationId,
            type: args.type,
            title: args.title,
            summary: args.summary,
            urgency: args.urgency,
          });
          ctx.ticketId = ticketId;
          created = true;
        }
        const ticket = db
          .select()
          .from(tickets)
          .where(eq(tickets.id, ticketId))
          .get();
        if (!ticket) {
          return `FEHLER: Ticket ${ticketId} existiert nicht.`;
        }
        db.update(messages)
          .set({ ticketId })
          .where(eq(messages.id, ctx.triggerMessageId))
          .run();
        const patch: Partial<typeof tickets.$inferInsert> = {
          updatedAt: new Date().toISOString(),
        };
        if (!created) {
          if (args.type !== undefined) patch.type = args.type;
          if (args.title !== undefined) patch.title = args.title;
          if (args.summary !== undefined) patch.summary = args.summary;
          if (args.urgency !== undefined) patch.urgency = args.urgency;
        }
        if (args.appointmentAt !== undefined) {
          patch.appointmentAt = args.appointmentAt;
        }
        if (args.setInfo !== undefined && args.setInfo.length > 0) {
          const info = JSON.parse(ticket.collectedInfo) as Record<string, string>;
          for (const entry of args.setInfo) {
            info[entry.key] = entry.value;
          }
          patch.collectedInfo = JSON.stringify(info);
        }
        db.update(tickets).set(patch).where(eq(tickets.id, ticketId)).run();
        if (args.status !== undefined) {
          try {
            transitionTicket(ticketId, args.status);
          } catch (err) {
            if (err instanceof InvalidTransitionError) {
              return `FEHLER: ${err.message}`;
            }
            throw err;
          }
        }
        const after = db
          .select()
          .from(tickets)
          .where(eq(tickets.id, ticketId))
          .get();
        return `Ticket [HV-${ticketId}] ${created ? "angelegt" : "aktualisiert"}. Status: ${after?.status ?? "unbekannt"}.`;
      },
    },
    {
      name: "request_approval",
      description:
        "Erstellt einen Genehmigungsantrag für den Vermieter inklusive fertigem Mail-Entwurf an einen Handwerker. Nutze es erst, wenn genug Infos vorliegen (Problem, Dringlichkeit, 2-3 Terminfenster des Mieters) und ein Ticket existiert. Setzt den Ticket-Status automatisch auf wartet_auf_genehmigung. Die Handwerker-Mail wird NICHT sofort gesendet — erst nach Freigabe des Vermieters im Dashboard. Sende dem Mieter danach einen Zwischenbescheid via send_reply.",
      inputSchema: requestApprovalSchema,
      run: async (input) => {
        const args = requestApprovalSchema.parse(input);
        const db = getDb();
        const ticketId = ctx.ticketId;
        if (ticketId === null) {
          return "FEHLER: Es existiert noch kein Ticket. Lege zuerst mit update_ticket ein Ticket an.";
        }
        const contractor = db
          .select()
          .from(contractors)
          .where(eq(contractors.id, args.contractorId))
          .get();
        if (!contractor) {
          return `FEHLER: Handwerker mit Id ${args.contractorId} ist nicht bekannt. Wähle eine Id aus der Handwerkerliste im Systemprompt.`;
        }
        const ticket = db
          .select()
          .from(tickets)
          .where(eq(tickets.id, ticketId))
          .get();
        if (!ticket) {
          return `FEHLER: Ticket ${ticketId} existiert nicht.`;
        }
        if (!canTransition(ticket.status as TicketStatus, "wartet_auf_genehmigung")) {
          return `FEHLER: Ungültiger Statuswechsel: ${ticket.status} → wartet_auf_genehmigung`;
        }
        const { id: approvalId } = db
          .insert(approvals)
          .values({
            ticketId,
            summary: args.summary,
            contractorId: args.contractorId,
            emailSubject: args.emailSubject,
            emailBody: args.emailBody,
          })
          .returning({ id: approvals.id })
          .get();
        transitionTicket(ticketId, "wartet_auf_genehmigung");
        if (args.urgency !== undefined) {
          db.update(tickets)
            .set({ urgency: args.urgency, updatedAt: new Date().toISOString() })
            .where(eq(tickets.id, ticketId))
            .run();
        }
        return `Genehmigungsantrag #${approvalId} für Ticket [HV-${ticketId}] an ${contractor.name} erstellt; der Vermieter entscheidet im Dashboard. Sende dem Mieter jetzt einen Zwischenbescheid via send_reply.`;
      },
    },
    {
      name: "ask_landlord",
      description:
        "Stellt dem Vermieter eine Rückfrage im Dashboard (Eskalation). Nutze es IMMER, wenn du nicht weiterweißt, eine Entscheidung des Vermieters nötig ist oder search_documents keine Antwort liefert — niemals raten. Ein vorhandenes Ticket wird auf Status eskaliert gesetzt; die Antwort des Vermieters erreicht dich später als neue Nachricht. Sende dem Mieter danach einen Zwischenbescheid via send_reply.",
      inputSchema: askLandlordSchema,
      run: async (input) => {
        const args = askLandlordSchema.parse(input);
        const db = getDb();
        const { id: escalationId } = db
          .insert(escalations)
          .values({
            ticketId: ctx.ticketId,
            conversationId: ctx.conversationId,
            question: args.question,
          })
          .returning({ id: escalations.id })
          .get();
        if (ctx.ticketId !== null) {
          const ticket = db
            .select()
            .from(tickets)
            .where(eq(tickets.id, ctx.ticketId))
            .get();
          if (
            ticket &&
            ticket.status !== "eskaliert" &&
            canTransition(ticket.status as TicketStatus, "eskaliert")
          ) {
            transitionTicket(ctx.ticketId, "eskaliert");
          }
        }
        return `Rückfrage #${escalationId} an den Vermieter gestellt; seine Antwort erreicht dich später als neue Nachricht. Sende dem Mieter jetzt einen Zwischenbescheid via send_reply.`;
      },
    },
    {
      name: "send_reply",
      description:
        "Sendet eine E-Mail. recipient 'mieter': Antwort an den Mieter — auf JEDE Mieter-Nachricht genau EINE Antwort senden, auch als Zwischenbescheid nach request_approval oder ask_landlord. recipient 'handwerker': NUR zur Terminbestätigung nach Genehmigung durch den Vermieter (Ticket-Status handwerker_angefragt oder terminiert), sonst FEHLER. Die Empfängeradresse wird serverseitig aus dem Vorgang bestimmt; der Ticket-Tag [HV-n] wird automatisch an den Betreff angehängt.",
      inputSchema: sendReplySchema,
      run: async (input) => {
        const args = sendReplySchema.parse(input);
        const db = getDb();
        let to: string;
        // Die Nachricht wird in der Conversation des EMPFÄNGERS protokolliert,
        // nicht in der auslösenden. Sonst landete eine Mieter-Antwort, die aus
        // einer Handwerker-Nachricht heraus entsteht, in der Handwerker-
        // Conversation — und fehlte beim nächsten Mieter-Schreiben im
        // Gesprächsverlauf, den buildTranscript() aus der Conversation baut.
        // Die KI wüsste dann nicht mehr, was sie dem Mieter gesagt hat.
        let targetConversationId: number;
        if (args.recipient === "mieter") {
          if (!ctx.tenant) {
            return "FEHLER: Kein Mieter im Kontext — eine Antwort an den Mieter ist nicht möglich.";
          }
          to = ctx.tenant.email;
          targetConversationId = findOrCreateConversation({
            email: ctx.tenant.email,
            counterpartType: "tenant",
            counterpartId: ctx.tenant.id,
          });
        } else {
          if (!ctx.contractor) {
            return "FEHLER: Kein Handwerker im Kontext — eine Antwort an den Handwerker ist nicht möglich.";
          }
          if (ctx.ticketId === null) {
            return "FEHLER: E-Mails an den Handwerker sind erst nach Genehmigung durch den Vermieter erlaubt (Ticket-Status handwerker_angefragt oder terminiert); es existiert aber noch kein Ticket.";
          }
          const ticket = db
            .select()
            .from(tickets)
            .where(eq(tickets.id, ctx.ticketId))
            .get();
          if (
            !ticket ||
            (ticket.status !== "handwerker_angefragt" && ticket.status !== "terminiert")
          ) {
            return `FEHLER: E-Mails an den Handwerker sind erst nach Genehmigung durch den Vermieter erlaubt (Ticket-Status handwerker_angefragt oder terminiert, aktuell: ${ticket?.status ?? "kein Ticket"}).`;
          }
          to = ctx.contractor.email;
          targetConversationId = findOrCreateConversation({
            email: ctx.contractor.email,
            counterpartType: "contractor",
            counterpartId: ctx.contractor.id,
          });
        }
        const subject =
          ctx.ticketId !== null ? ensureTag(args.subject, ctx.ticketId) : args.subject;
        try {
          const params = {
            to,
            subject,
            text: args.body,
            role: "ai" as const,
            conversationId: targetConversationId,
            ticketId: ctx.ticketId,
          };
          if (ctx.sendFn) {
            await sendAndLogEmail(params, ctx.sendFn);
          } else {
            await sendAndLogEmail(params);
          }
        } catch (err) {
          if (err instanceof RecipientNotAllowedError) {
            return `FEHLER: Empfänger ${to} steht nicht auf der Whitelist (weder als Mieter noch als Handwerker in der Datenbank hinterlegt).`;
          }
          if (err instanceof RateLimitExceededError) {
            return "FEHLER: Mail-Rate-Limit erreicht — der Versand wurde gestoppt und der Vermieter im Dashboard informiert.";
          }
          throw err;
        }
        if (args.recipient === "mieter") {
          ctx.repliedToTenant = true;
        }
        return `E-Mail an ${args.recipient === "mieter" ? "den Mieter" : "den Handwerker"} (${to}) gesendet. Betreff: "${subject}".`;
      },
    },
  ];
}
