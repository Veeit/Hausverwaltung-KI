import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contractors, tenants } from "@/db/schema";

export class RecipientNotAllowedError extends Error {}

export function isAllowedRecipient(email: string): boolean {
  const db = getDb();
  const normalized = email.toLowerCase();
  const tenant = db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.email, normalized))
    .get();
  if (tenant) return true;
  const contractor = db
    .select({ id: contractors.id })
    .from(contractors)
    .where(eq(contractors.email, normalized))
    .get();
  return contractor !== undefined;
}

export function assertAllowedRecipient(email: string): void {
  if (!isAllowedRecipient(email)) {
    throw new RecipientNotAllowedError(
      `Empfänger nicht erlaubt (nicht in der Whitelist): ${email}`,
    );
  }
}
