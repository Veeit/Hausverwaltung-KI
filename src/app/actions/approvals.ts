"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
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
  //
  // "eskaliert" ist ein dritter gültiger Startzustand (Review-Befund Punkt 4):
  // Stellt die KI während der Wartezeit eine Rückfrage (ask_landlord setzt das
  // Ticket automatisch auf "eskaliert"), wäre der Antrag sonst weder genehmigbar
  // noch ablehnbar, obwohl er unentschieden im Dashboard steht.
  if (
    ticket.status !== "wartet_auf_genehmigung" &&
    ticket.status !== "genehmigt" &&
    ticket.status !== "eskaliert"
  ) {
    throw new Error(
      `Ticket ${ticket.id} ist weder im Status "wartet_auf_genehmigung" noch "genehmigt" noch "eskaliert" (aktuell: "${ticket.status}").`,
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

  // Anspruch atomar sichern, BEVOR irgendetwas anderes passiert (Ticket-
  // Transition, Mailversand). Bedingtes Update: Es greift nur, wenn der
  // Antrag zu diesem Zeitpunkt noch "offen" ist. Zwischen den obigen
  // synchronen Lesezugriffen und hier liegt kein `await` — der komplette
  // Block läuft in einem Zug, ohne dass ein zweiter, überlappender Aufruf
  // dazwischenfunken kann. Wer zuerst hier ankommt, gewinnt den Anspruch;
  // der andere sieht unten `changes === 0`.
  // Vorher stand dieses Update erst NACH dem Mailversand — damit sahen zwei
  // überlappende Aufrufe beide noch status="offen" und schickten dem
  // Handwerker beide eine Mail (Doppelversand).
  const claim = db
    .update(approvals)
    .set({ status: "genehmigt", decidedAt: new Date().toISOString() })
    .where(and(eq(approvals.id, approval.id), eq(approvals.status, "offen")))
    .run();
  if (claim.changes === 0) {
    throw new Error(
      `Genehmigungsantrag ${approvalId} wurde soeben bereits in einem anderen Vorgang entschieden. Bitte die Seite neu laden.`,
    );
  }

  try {
    // Zwischenstation "genehmigt" nur, wenn der Ausgangsstatus das erfordert:
    // wartet_auf_genehmigung → genehmigt ist der einzige direkte Weg dorthin.
    // Aus "eskaliert" heraus ist "handwerker_angefragt" laut TICKET_TRANSITIONS
    // dagegen bereits direkt erreichbar (kein Umweg über "genehmigt" nötig,
    // der dort auch gar nicht erlaubt wäre) — der abschließende
    // transitionTicket(..., "handwerker_angefragt") weiter unten übernimmt das.
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

    db.update(tickets)
      .set({ contractorId: contractor.id })
      .where(eq(tickets.id, ticket.id))
      .run();

    transitionTicket(ticket.id, "handwerker_angefragt");
  } catch (err) {
    // Wiederholbarkeit erhalten: Der Anspruch oben ist bereits gesichert,
    // aber danach ist etwas schiefgegangen (typischerweise der SMTP-Versand).
    // Antrag zurück auf "offen", damit ein erneuter Klick den Vorgang zu Ende
    // bringen kann, statt dauerhaft in einem Zwischenzustand hängen zu
    // bleiben ("genehmigt", aber ohne dass je eine Mail rausging).
    // Bekannte Einschränkung (für den PoC hinnehmbar): Stürzt der Prozess
    // exakt zwischen erfolgreichem Mailversand und diesem catch-Block ab,
    // bleibt der Antrag auf "genehmigt" stehen, obwohl der weitere
    // Statuswechsel (Ticket → handwerker_angefragt) nicht mehr passiert ist.
    db.update(approvals)
      .set({ status: "offen", decidedAt: null })
      .where(eq(approvals.id, approval.id))
      .run();
    throw err;
  }

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
  // Spiegelbild des Guards in approveApproval: Der Ticket-Status wird VOR
  // jedem Schreibzugriff geprüft. "abgelehnt" ist laut TICKET_TRANSITIONS aus
  // "wartet_auf_genehmigung" ODER "eskaliert" heraus ein gültiges Ziel (Review-
  // Befund Punkt 4: Stellt die KI während der Wartezeit eine Rückfrage,
  // wechselt das Ticket automatisch nach "eskaliert" — der Antrag muss auch
  // dann noch ablehnbar bleiben, sonst steht er unentscheidbar im Dashboard).
  // Jeder andere Status wird weiterhin VOR jedem Schreibzugriff abgelehnt:
  // würde transitionTicket weiter unten erst NACH dem approvals-Update werfen,
  // bliebe der Antrag unwiderruflich auf "abgelehnt" stehen, ohne dass der
  // Mieter je über die synthetische Nachricht informiert wird.
  if (ticket.status !== "wartet_auf_genehmigung" && ticket.status !== "eskaliert") {
    throw new Error(
      `Ticket ${ticket.id} ist nicht mehr im Status "wartet_auf_genehmigung" oder "eskaliert" ` +
        `(aktuell: "${ticket.status}") und kann daher nicht abgelehnt werden. Der Antrag bleibt offen ` +
        `— bitte Ticket ${buildTicketTag(ticket.id)} zunächst dort prüfen und die Ablehnung danach erneut versuchen.`,
    );
  }

  // Reihenfolge bewusst gewählt: Die Benachrichtigung des Mieters ist der
  // eigentliche Zweck der Ablehnung und darf nicht übersprungen werden, falls
  // ein späterer Schritt scheitert — deshalb zuerst die synthetische
  // Nachricht anlegen, danach erst die Ticket-Transition und zuletzt den
  // Antrag als entschieden markieren.
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

  transitionTicket(ticket.id, "abgelehnt");

  db.update(approvals)
    .set({
      status: "abgelehnt",
      decisionNote: note,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(approvals.id, approval.id))
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
