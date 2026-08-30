import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { setDbForTesting, type AppDb } from "@/db/client";
import { conversations } from "@/db/schema";
import { findOrCreateConversation, touchConversation } from "@/lib/conversations";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

describe("findOrCreateConversation", () => {
  it("legt eine neue Conversation an und speichert die E-Mail lowercase", () => {
    const id = findOrCreateConversation({
      email: "Max.Mustermann@Example.COM",
      counterpartType: "tenant",
      counterpartId: 1,
      subject: "Türschloss defekt",
    });

    const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.counterpartEmail).toBe("max.mustermann@example.com");
    expect(row?.counterpartType).toBe("tenant");
    expect(row?.counterpartId).toBe(1);
    expect(row?.subject).toBe("Türschloss defekt");
  });

  it("findet die bestehende Conversation statt eine zweite anzulegen (case-insensitiv)", () => {
    const first = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: 1,
    });
    const second = findOrCreateConversation({
      email: "MAX.MUSTERMANN@EXAMPLE.COM",
      counterpartType: "tenant",
      counterpartId: 1,
    });

    expect(second).toBe(first);
    expect(db.select().from(conversations).all()).toHaveLength(1);
  });

  // Review-Befund: Ohne .trim() legte eine E-Mail mit umgebenden Leerzeichen
  // (z.B. aus einem kopierten Mail-Header) eine ZWEITE, doppelte Conversation
  // an, statt die bestehende zu finden.
  it("ignoriert umgebende Leerzeichen und findet dieselbe Conversation", () => {
    const first = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: 1,
    });
    const second = findOrCreateConversation({
      email: "  max.mustermann@example.com  ",
      counterpartType: "tenant",
      counterpartId: 1,
    });

    expect(second).toBe(first);
    expect(db.select().from(conversations).all()).toHaveLength(1);
    const row = db.select().from(conversations).where(eq(conversations.id, first)).get();
    expect(row?.counterpartEmail).toBe("max.mustermann@example.com");
  });

  it("wertet eine unknown-Conversation zu tenant auf, wenn der Absender später bekannt ist", () => {
    const id = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "unknown",
    });
    let row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.counterpartType).toBe("unknown");
    expect(row?.counterpartId).toBeNull();

    const again = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: 5,
    });

    expect(again).toBe(id);
    row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.counterpartType).toBe("tenant");
    expect(row?.counterpartId).toBe(5);
  });

  it("überschreibt eine bekannte Conversation NICHT mit unknown", () => {
    const id = findOrCreateConversation({
      email: "klaus.rohr@example.com",
      counterpartType: "contractor",
      counterpartId: 7,
    });

    findOrCreateConversation({
      email: "klaus.rohr@example.com",
      counterpartType: "unknown",
    });

    const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.counterpartType).toBe("contractor");
    expect(row?.counterpartId).toBe(7);
  });
});

describe("touchConversation", () => {
  it("setzt lastMessageAt auf einen aktuellen ISO-Zeitstempel", () => {
    const id = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: 1,
    });
    let row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.lastMessageAt).toBeNull();

    const before = new Date(Date.now() - 1000).toISOString();
    touchConversation(id);

    row = db.select().from(conversations).where(eq(conversations.id, id)).get();
    expect(row?.lastMessageAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((row?.lastMessageAt ?? "") >= before).toBe(true);
  });
});
