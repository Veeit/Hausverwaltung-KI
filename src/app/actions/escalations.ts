"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { escalations, messages, tickets } from "@/db/schema";
import { getEnv } from "@/env";
import { ensureTag } from "@/lib/subject";
import { requireAuth } from "@/app/actions/auth";

export async function answerEscalation(
  escalationId: number,
  answer: string,
): Promise<void> {
  await requireAuth();
  const db = getDb();

  const escalation = db
    .select()
    .from(escalations)
    .where(eq(escalations.id, escalationId))
    .get();
  if (!escalation) {
    throw new Error(`Eskalation ${escalationId} nicht gefunden.`);
  }
  if (escalation.status !== "offen") {
    throw new Error(`Eskalation ${escalationId} ist bereits beantwortet.`);
  }
  if (answer.trim() === "") {
    throw new Error("Die Antwort darf nicht leer sein.");
  }

  db.update(escalations)
    .set({
      answer,
      status: "beantwortet",
      answeredAt: new Date().toISOString(),
    })
    .where(eq(escalations.id, escalationId))
    .run();

  const ticket =
    escalation.ticketId != null
      ? (db
          .select()
          .from(tickets)
          .where(eq(tickets.id, escalation.ticketId))
          .get() ?? null)
      : null;

  const body = `Antwort des Vermieters auf die Rückfrage "${escalation.question}": ${answer}\nBitte formuliere daraus eine Antwort an den Mieter.`;

  db.insert(messages)
    .values({
      conversationId: escalation.conversationId,
      ticketId: ticket ? ticket.id : null,
      direction: "inbound",
      role: "landlord",
      fromEmail: "vermieter@dashboard.intern",
      toEmail: getEnv().MAIL_ALIAS,
      subject: ticket ? ensureTag(ticket.title, ticket.id) : "Antwort des Vermieters",
      body,
      processingStatus: "pending",
    })
    .run();

  revalidatePath("/eskalationen");
  revalidatePath("/");
}
