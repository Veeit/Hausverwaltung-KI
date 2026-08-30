"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getEnv } from "@/env";
import { getDb } from "@/db/client";
import { approvals, contractors, messages, tickets } from "@/db/schema";
import { transitionTicket } from "@/lib/tickets";
import { buildTicketTag, ensureTag } from "@/lib/subject";
import { findOrCreateConversation } from "@/lib/conversations";
import { sendAndLogEmail } from "@/lib/outbound";
import { requireAuth } from "./auth";

function loadOpenApproval(approvalId: number) {
  const db = getDb();
  const approval = db.select().from(approvals).where(eq(approvals.id, approvalId)).get();
  if (!approval) {
    throw new Error(`Genehmigungsantrag ${approvalId} nicht gefunden.`);
  }
  if (approval.status !== "offen") {
    throw new Error(`Genehmigungsantrag ${approvalId} ist bereits entschieden.`);
  }
  return approval;
}

function revalidateApprovalPages(ticketId: number): void {
  revalidatePath("/genehmigungen");
  revalidatePath("/vorgaenge");
  revalidatePath(`/vorgaenge/${ticketId}`);
  revalidatePath("/");
}

export async function approveApproval(approvalId: number): Promise<void> {
  await requireAuth();
  const db = getDb();

  const approval = loadOpenApproval(approvalId);
  const ticket = db.select().from(tickets).where(eq(tickets.id, approval.ticketId)).get();
  if (!ticket) {
    throw new Error(`Ticket ${approval.ticketId} nicht gefunden.`);
  }
  // "genehmigt" ist hier ebenfalls ein gültiger Startzustand, damit die Aktion
  // WIEDERHOLBAR ist: Schlägt der SMTP-Versand unten fehl, steht das Ticket
  // bereits auf "genehmigt", der Antrag aber noch auf "offen". Ohne diesen
  // zweiten erlaubten Zustand wäre der Vorgang danach dauerhaft blockiert —
  // der zweite Klick würde abgelehnt und die Handwerker-Mail nie rausgehen.
  if (ticket.status !== "wartet_auf_genehmigung" && ticket.status !== "genehmigt") {
    throw new Error(
      `Ticket ${ticket.id} ist weder im Status "wartet_auf_genehmigung" noch "genehmigt" (aktuell: "${ticket.status}").`,
    );
  }
  const contractor = db
    .select()
    .from(contractors)
    .where(eq(contractors.id, approval.contractorId))
    .get();
  if (!contractor) {
    throw new Error(`Handwerker ${approval.contractorId} nicht gefunden.`);
  }

  if (ticket.status === "wartet_auf_genehmigung") {
    transitionTicket(ticket.id, "genehmigt");
  }

  const convId = findOrCreateConversation({
    email: contractor.email,
    counterpartType: "contractor",
    counterpartId: contractor.id,
  });

  await sendAndLogEmail({
    to: contractor.email,
    subject: ensureTag(approval.emailSubject, ticket.id),
    text: approval.emailBody,
    role: "landlord",
    conversationId: convId,
    ticketId: ticket.id,
  });

  db.update(approvals)
    .set({ status: "genehmigt", decidedAt: new Date().toISOString() })
    .where(eq(approvals.id, approval.id))
    .run();

  db.update(tickets)
    .set({ contractorId: contractor.id })
    .where(eq(tickets.id, ticket.id))
    .run();

  transitionTicket(ticket.id, "handwerker_angefragt");

  revalidateApprovalPages(ticket.id);
}

export async function rejectApproval(approvalId: number, note: string): Promise<void> {
  await requireAuth();
  const db = getDb();

  const approval = loadOpenApproval(approvalId);
  const ticket = db.select().from(tickets).where(eq(tickets.id, approval.ticketId)).get();
  if (!ticket) {
    throw new Error(`Ticket ${approval.ticketId} nicht gefunden.`);
  }

  db.update(approvals)
    .set({
      status: "abgelehnt",
      decisionNote: note,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(approvals.id, approval.id))
    .run();

  transitionTicket(ticket.id, "abgelehnt");

  db.insert(messages)
    .values({
      conversationId: ticket.conversationId,
      ticketId: ticket.id,
      direction: "inbound",
      role: "landlord",
      fromEmail: "vermieter@dashboard.intern",
      toEmail: getEnv().MAIL_ALIAS,
      subject: ensureTag(ticket.title, ticket.id),
      body: `Der Vermieter hat den Genehmigungsantrag zu Ticket ${buildTicketTag(ticket.id)} abgelehnt. Begründung: ${note}. Bitte informiere den Mieter freundlich und biete ggf. Alternativen an.`,
      processingStatus: "pending",
    })
    .run();

  revalidateApprovalPages(ticket.id);
}

export async function updateApprovalDraft(
  approvalId: number,
  emailSubject: string,
  emailBody: string,
): Promise<void> {
  await requireAuth();
  const db = getDb();

  const approval = loadOpenApproval(approvalId);

  db.update(approvals)
    .set({ emailSubject, emailBody })
    .where(eq(approvals.id, approval.id))
    .run();

  revalidatePath("/genehmigungen");
}
