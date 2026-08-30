"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, tickets } from "@/db/schema";
import { TICKET_STATUSES, transitionTicket, type TicketStatus } from "@/lib/tickets";
import { buildTicketTag } from "@/lib/subject";
import { sendAndLogEmail } from "@/lib/outbound";
import { requireAuth } from "./auth";

export async function setTicketStatus(ticketId: number, status: TicketStatus): Promise<void> {
  await requireAuth();
  // Der TypeScript-Typ TicketStatus schützt hier nicht: Als Export einer
  // "use server"-Datei ist diese Funktion ein eigenständiger, per POST direkt
  // ansprechbarer Endpunkt, der auch mit einem beliebigen String aufgerufen
  // werden kann. `force: true` unten überspringt den canTransition-Check,
  // daher muss der Wert vorher gegen die bekannten Status geprüft werden.
  if (!(TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Unbekannter Status "${status}": Vorgang kann nicht aktualisiert werden.`);
  }
  transitionTicket(ticketId, status, { force: true });
  revalidatePath("/vorgaenge");
  revalidatePath(`/vorgaenge/${ticketId}`);
  revalidatePath("/");
}

export async function sendManualReply(ticketId: number, text: string): Promise<void> {
  await requireAuth();
  const db = getDb();

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) {
    throw new Error(`Ticket ${ticketId} nicht gefunden.`);
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Der Antworttext darf nicht leer sein.");
  }

  const tenant = db.select().from(tenants).where(eq(tenants.id, ticket.tenantId)).get();
  if (!tenant) {
    throw new Error(`Mieter ${ticket.tenantId} nicht gefunden.`);
  }

  await sendAndLogEmail({
    to: tenant.email,
    subject: `Ihre Anfrage ${buildTicketTag(ticket.id)}`,
    text: trimmed,
    role: "landlord",
    conversationId: ticket.conversationId,
    ticketId: ticket.id,
  });

  revalidatePath("/vorgaenge");
  revalidatePath(`/vorgaenge/${ticketId}`);
  revalidatePath("/");
}
