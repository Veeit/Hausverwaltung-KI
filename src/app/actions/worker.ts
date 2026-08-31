"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { resumeWorker } from "@/lib/rateLimit";
import { requireAuth } from "@/app/actions/auth";
import { getDb } from "@/db/client";
import { contractors, conversations, messages, tenants } from "@/db/schema";

export async function resumeWorkerAction(): Promise<void> {
  await requireAuth();
  resumeWorker();
  revalidatePath("/");
}

/**
 * Gibt eine Nachricht eines damals unbekannten Absenders erneut zur
 * Verarbeitung frei, nachdem der Vermieter ihn nachträglich in den
 * Stammdaten als Mieter oder Handwerker angelegt hat. Ohne diese Aktion
 * bliebe die allererste Mail eines solchen Absenders für immer
 * unverarbeitet: role "unknown" wird von processPendingMessages()
 * dauerhaft ausgeschlossen (siehe src/worker/processor.ts), unabhängig
 * davon, ob der Absender inzwischen bekannt ist.
 */
export async function reprocessMessage(messageId: number): Promise<void> {
  await requireAuth();
  const db = getDb();

  const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!message) {
    throw new Error(`Nachricht ${messageId} nicht gefunden.`);
  }
  if (message.role !== "unknown") {
    throw new Error(
      `Nachricht ${messageId} ist keiner unbekannten Absenderin/keinem unbekannten Absender zugeordnet und kann daher nicht erneut freigegeben werden.`,
    );
  }

  const from = message.fromEmail.trim().toLowerCase();
  const tenant = db.select().from(tenants).where(eq(tenants.email, from)).get();
  const contractor = tenant ? undefined : db.select().from(contractors).where(eq(contractors.email, from)).get();
  if (!tenant && !contractor) {
    throw new Error(
      `Absender ${message.fromEmail} ist weiterhin keinem Mieter oder Handwerker zugeordnet. Bitte zuerst in den Stammdaten anlegen.`,
    );
  }

  const role = tenant ? "tenant" : "contractor";
  const counterpartId = tenant ? tenant.id : contractor!.id;

  // Conversation von "unknown" auf den jetzt bekannten Typ hochstufen — dieselbe
  // Logik wie findOrCreateConversation() beim regulären Ingest einer Folgemail.
  db.update(conversations)
    .set({ counterpartType: role, counterpartId })
    .where(eq(conversations.id, message.conversationId))
    .run();

  db.update(messages)
    .set({ role, processingStatus: "pending" })
    .where(eq(messages.id, messageId))
    .run();

  revalidatePath("/");
}
