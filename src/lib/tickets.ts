import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tickets } from "@/db/schema";

export const TICKET_STATUSES = ["neu","infosammlung","wartet_auf_genehmigung","genehmigt","handwerker_angefragt","terminiert","erledigt","eskaliert","abgelehnt"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_TYPES = ["reparatur","frage","sonstiges"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const URGENCIES = ["niedrig","mittel","hoch","notfall"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  neu: ["infosammlung","wartet_auf_genehmigung","eskaliert","erledigt"],
  infosammlung: ["wartet_auf_genehmigung","eskaliert","erledigt"],
  wartet_auf_genehmigung: ["genehmigt","abgelehnt","eskaliert"],
  genehmigt: ["handwerker_angefragt","eskaliert"],
  handwerker_angefragt: ["terminiert","eskaliert","erledigt"],
  terminiert: ["erledigt","eskaliert"],
  eskaliert: ["infosammlung","wartet_auf_genehmigung","handwerker_angefragt","terminiert","erledigt"],
  abgelehnt: ["infosammlung","wartet_auf_genehmigung","erledigt"],
  erledigt: [],
};

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  const allowedTargets = TICKET_TRANSITIONS[from];
  if (!allowedTargets) {
    // Kann auftreten, wenn `from` aus der Datenbank stammt (Altbestand,
    // direkter DB-Zugriff) und kein bekannter Status mehr ist. Ohne diese
    // Prüfung würde TICKET_TRANSITIONS[from] undefined liefern und der
    // nachfolgende .includes()-Aufruf einen nichtssagenden TypeError werfen.
    throw new Error(
      `Unbekannter Ticketstatus "${from}": Statuswechsel kann nicht geprüft werden.`,
    );
  }
  return allowedTargets.includes(to);
}

export function createTicket(input: {
  tenantId: number;
  conversationId: number;
  type: TicketType;
  title: string;
  summary?: string;
  urgency?: Urgency;
}): number {
  const db = getDb();
  const result = db
    .insert(tickets)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      urgency: input.urgency ?? null,
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function transitionTicket(
  ticketId: number,
  to: TicketStatus,
  opts?: { force?: boolean },
): void {
  const db = getDb();
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) {
    throw new Error(`Ticket ${ticketId} nicht gefunden`);
  }
  const from = ticket.status as TicketStatus;
  if (!opts?.force && !canTransition(from, to)) {
    throw new InvalidTransitionError(`Ungültiger Statuswechsel: ${from} → ${to}`);
  }
  db.update(tickets)
    .set({ status: to, updatedAt: new Date().toISOString() })
    .where(eq(tickets.id, ticketId))
    .run();
}
