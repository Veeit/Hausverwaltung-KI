import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import {
  RateLimitExceededError,
  WORKER_PAUSED_KEY,
  assertRateLimit,
  countOutboundLastHour,
  isWorkerPaused,
  resumeWorker,
} from "@/lib/rateLimit";
import { makeTestDb } from "../helpers/db";

let db: AppDb;
let conversationId: number;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "veit@fastmail.com";
  process.env.MAIL_PASSWORD = "test-app-passwort";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "test";
  process.env.MAIL_RATE_LIMIT_PER_HOUR = "3";
  db = makeTestDb();
  conversationId = Number(
    db
      .insert(conversations)
      .values({
        counterpartType: "tenant",
        counterpartEmail: "max.mustermann@example.com",
      })
      .run().lastInsertRowid,
  );
});

afterEach(() => {
  setDbForTesting(null);
});

function insertMessage(direction: "inbound" | "outbound", createdAt?: string): void {
  db.insert(messages)
    .values({
      conversationId,
      direction,
      role: direction === "outbound" ? "ai" : "tenant",
      fromEmail:
        direction === "outbound"
          ? "hausverwaltung@example.com"
          : "max.mustermann@example.com",
      toEmail:
        direction === "outbound"
          ? "max.mustermann@example.com"
          : "hausverwaltung@example.com",
      body: "Testnachricht",
      createdAt: createdAt ?? new Date().toISOString(),
    })
    .run();
}

describe("countOutboundLastHour", () => {
  it("zählt nur outbound-Messages der letzten Stunde", () => {
    insertMessage("outbound");
    insertMessage("outbound");
    insertMessage("inbound"); // zählt nicht: eingehend
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    insertMessage("outbound", twoHoursAgo); // zählt nicht: älter als 1h

    expect(countOutboundLastHour()).toBe(2);
  });

  it("liefert 0 bei leerer Datenbank", () => {
    expect(countOutboundLastHour()).toBe(0);
  });
});

describe("assertRateLimit", () => {
  it("wirft nicht unter dem Limit und pausiert den Worker nicht", () => {
    insertMessage("outbound");
    insertMessage("outbound");

    expect(() => assertRateLimit()).not.toThrow();
    expect(isWorkerPaused()).toBe(false);
  });

  it("wirft RateLimitExceededError bei erreichtem Limit UND setzt worker_paused", () => {
    insertMessage("outbound");
    insertMessage("outbound");
    insertMessage("outbound");

    expect(() => assertRateLimit()).toThrow(RateLimitExceededError);
    expect(getSetting(WORKER_PAUSED_KEY)).toBe("1");
    expect(isWorkerPaused()).toBe(true);
  });

  it("zählt outbound-Messages älter als eine Stunde nicht mit", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    insertMessage("outbound", twoHoursAgo);
    insertMessage("outbound", twoHoursAgo);
    insertMessage("outbound", twoHoursAgo);
    insertMessage("outbound"); // nur diese eine zählt

    expect(() => assertRateLimit()).not.toThrow();
    expect(isWorkerPaused()).toBe(false);
  });
});

describe("isWorkerPaused / resumeWorker", () => {
  it("ist anfangs nicht pausiert", () => {
    expect(isWorkerPaused()).toBe(false);
  });

  it("resumeWorker hebt die Pause wieder auf", () => {
    insertMessage("outbound");
    insertMessage("outbound");
    insertMessage("outbound");
    expect(() => assertRateLimit()).toThrow(RateLimitExceededError);
    expect(isWorkerPaused()).toBe(true);

    resumeWorker();

    expect(isWorkerPaused()).toBe(false);
    expect(getSetting(WORKER_PAUSED_KEY)).toBeNull();
  });
});
