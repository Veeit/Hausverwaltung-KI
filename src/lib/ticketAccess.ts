import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contractors, tenants, tickets } from "@/db/schema";
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
 * - der Handwerker, der AKTUELL für dieses Ticket beauftragt ist
 *   (tickets.contractorId)
 *
 * Beide Zweige (Mieter- UND Handwerker-Tabelle) werden unabhängig von der
 * beim Ingest ermittelten Rolle (input.role) geprüft: Steht dieselbe Adresse
 * SOWOHL als Mieter ALS AUCH als Handwerker in den Stammdaten (realistisch,
 * z. B. ein Hausmeister, der selbst im Haus wohnt), gewinnt bei der
 * Rollenklassifikation in worker/processor.ts immer der Mieter — würde hier
 * nur der Mieter-Zweig geprüft, liefe eine Handwerker-Antwort dieser Adresse
 * grundlos ins Leere.
 *
 * Bewusst NICHT (mehr) geprüft: eine genehmigte approvals-Zeile allein.
 * Damit würde ein Handwerker, der für ein Ticket EINMAL genehmigt war,
 * unbegrenzt Zugriff behalten, selbst nachdem der Vermieter einen anderen
 * Handwerker beauftragt und tickets.contractorId dadurch überschrieben hat
 * (approveApproval setzt Genehmigung UND contractorId in derselben Aktion,
 * kurz nacheinander — der einzige denkbare Zeitraum dazwischen liegt
 * innerhalb dieser einen Aktion und wird von dieser Funktion nie in diesem
 * Fenster aufgerufen, da eingehende Handwerker-Mails immer aus einer
 * separaten, späteren Anfrage stammen). tickets.contractorId ist deshalb die
 * einzige verlässliche Quelle für "aktuell beauftragt".
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

  // role "landlord"/"ai": der Betreff-Tag allein berechtigt nie — Vermieter-
  // Nachrichten hängen ihr Ticket explizit über messages.ticketId an (siehe
  // rejectApproval, answerEscalation), nicht über den Betreff. role
  // "unknown" kann per Definition (siehe worker/processor.ts) mit keiner der
  // beiden Tabellen matchen, muss die Zweige unten also gar nicht erst prüfen.
  if (input.role !== "landlord" && input.role !== "ai" && input.role !== "unknown") {
    const tenant = db.select({ id: tenants.id }).from(tenants).where(eq(tenants.email, email)).get();
    if (tenant && ticket.tenantId === tenant.id) {
      authorized = true;
    }
    if (!authorized) {
      const contractor = db
        .select({ id: contractors.id })
        .from(contractors)
        .where(eq(contractors.email, email))
        .get();
      if (contractor && ticket.contractorId === contractor.id) {
        authorized = true;
      }
    }
  }

  if (authorized) return taggedId;

  console.warn(
    `[ticketAccess] Betreff-Tag [HV-${taggedId}] verworfen: Absender ${email} (Rolle "${input.role}", ` +
      `Conversation ${input.conversationId}) ist diesem Vorgang nicht zugeordnet.`,
  );
  return null;
}
