import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations } from "@/db/schema";

export function findOrCreateConversation(input: {
  email: string;
  counterpartType: "tenant" | "contractor" | "unknown";
  counterpartId?: number | null;
  subject?: string;
}): number {
  const db = getDb();
  // .trim() wie in src/lib/recipients.ts: ohne diesen Trim würde dieselbe
  // E-Mail-Adresse mit Leerzeichen-Umgebung (z.B. aus einem kopierten
  // Mail-Header) eine zweite, doppelte Conversation anlegen statt die
  // bestehende zu finden.
  const email = input.email.trim().toLowerCase();

  const existing = db
    .select()
    .from(conversations)
    .where(eq(conversations.counterpartEmail, email))
    .get();

  if (existing) {
    if (existing.counterpartType === "unknown" && input.counterpartType !== "unknown") {
      db.update(conversations)
        .set({
          counterpartType: input.counterpartType,
          counterpartId: input.counterpartId ?? null,
        })
        .where(eq(conversations.id, existing.id))
        .run();
    }
    return existing.id;
  }

  const result = db
    .insert(conversations)
    .values({
      counterpartType: input.counterpartType,
      counterpartId: input.counterpartId ?? null,
      counterpartEmail: email,
      subject: input.subject ?? null,
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function touchConversation(id: number): void {
  const db = getDb();
  db.update(conversations)
    .set({ lastMessageAt: new Date().toISOString() })
    .where(eq(conversations.id, id))
    .run();
}
