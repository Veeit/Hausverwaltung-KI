import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { messages } from "@/db/schema";
import { getEnv } from "@/env";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

export class RateLimitExceededError extends Error {}

export const WORKER_PAUSED_KEY = "worker_paused";

export function countOutboundLastHour(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - 3600_000).toISOString();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.direction, "outbound"), gte(messages.createdAt, cutoff)))
    .get();
  return row?.count ?? 0;
}

export function assertRateLimit(): void {
  const limit = getEnv().MAIL_RATE_LIMIT_PER_HOUR;
  if (countOutboundLastHour() >= limit) {
    setSetting(WORKER_PAUSED_KEY, "1");
    throw new RateLimitExceededError(
      `Mail-Rate-Limit erreicht (max. ${limit} ausgehende Mails pro Stunde) — Worker pausiert.`,
    );
  }
}

export function isWorkerPaused(): boolean {
  return getSetting(WORKER_PAUSED_KEY) === "1";
}

export function resumeWorker(): void {
  deleteSetting(WORKER_PAUSED_KEY);
}
