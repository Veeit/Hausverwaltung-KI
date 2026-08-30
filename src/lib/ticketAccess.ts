import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, contractors, tenants, tickets } from "@/db/schema";
import { extractTicketId } from "@/lib/subject";

/**
 * Löst den [HV-n]-Betreff-Tag NUR auf, wenn der Absender tatsächlich zu
 * diesem Vorgang gehört. Ohne diese Prüfung kann jeder, der eine Ticket-
 * Nummer errät oder aus einer alten Mail kennt, per Betreff-Tag fremde
 * Vorgänge lesen (der komplette Ticket-Datensatz landet über
 * buildSystemPrompt im KI-Kontext) UND über update_ticket verändern.
 *
 * Berechtigt sind:
 * - der Mieter, dem das Ticket gehört (tickets.tenantId)
 * - ein Handwerker, der für GENAU dieses Ticket beauftragt ist — entweder
 *   über tickets.contractorId oder über eine genehmigte approvals-Zeile für
 *   dieses Ticket und diesen Handwerker (deckt den Zeitraum zwischen
 *   Genehmigung und dem Setzen von tickets.contractorId in approveApproval
 *   ab, sowie den Fall, dass mehrere Handwerker im Lauf der Zeit an einem
 *   Ticket beteiligt waren).
 *
 * Diese Funktion ist die EINZIGE Stelle, die den Tag in eine Ticket-Id
 * übersetzt — sowohl beim Ingest (src/worker/processor.ts) als auch bei der
 * Agent-Kontext-Auflösung (src/agent/context.ts). Ein Fix nur an einer der
 * beiden Stellen würde die andere weiterhin angreifbar lassen.
 *
 * Ein verworfener Tag (Tag vorhanden, Ticket existiert, aber Absender ist
 * nicht berechtigt) wird geloggt, damit ein Mieter oder Handwerker, der
 * wiederholt fremde Vorgangsnummern rät, im Server-Log auffällt.
 */
export function resolveAuthorizedTaggedTicketId(input: {
  subject: string | null | undefined;
  role: string;
  fromEmail: string;
  conversationId: number;
}): number | null {
  const taggedId = extractTicketId(input.subject);
  if (taggedId === null) return null;

  const db = getDb();
  const ticket = db
    .select({ id: tickets.id, tenantId: tickets.tenantId, contractorId: tickets.contractorId })
    .from(tickets)
    .where(eq(tickets.id, taggedId))
    .get();
  if (!ticket) return null;

  const email = input.fromEmail.trim().toLowerCase();
  let authorized = false;

  if (input.role === "tenant") {
    const tenant = db.select({ id: tenants.id }).from(tenants).where(eq(tenants.email, email)).get();
    authorized = tenant !== undefined && ticket.tenantId === tenant.id;
  } else if (input.role === "contractor") {
    const contractor = db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.email, email))
      .get();
    if (contractor) {
      if (ticket.contractorId === contractor.id) {
        authorized = true;
      } else {
        const approval = db
          .select({ id: approvals.id })
          .from(approvals)
          .where(
            and(
              eq(approvals.ticketId, taggedId),
              eq(approvals.contractorId, contractor.id),
              eq(approvals.status, "genehmigt"),
            ),
          )
          .get();
        authorized = approval !== undefined;
      }
    }
  }
  // role "landlord" / "unknown" / "ai": der Betreff-Tag allein berechtigt nie —
  // Vermieter-Nachrichten hängen ihr Ticket explizit über messages.ticketId an
  // (siehe rejectApproval, answerEscalation), nicht über den Betreff.

  if (authorized) return taggedId;

  console.warn(
    `[ticketAccess] Betreff-Tag [HV-${taggedId}] verworfen: Absender ${email} (Rolle "${input.role}", ` +
      `Conversation ${input.conversationId}) ist diesem Vorgang nicht zugeordnet.`,
  );
  return null;
}
