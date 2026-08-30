import { describe, it, expect } from "vitest";
import { filterToAlias } from "@/channel/imap";
import type { IncomingEmail } from "@/channel/types";

function makeMail(to: string[]): IncomingEmail {
  return {
    messageId: `<test-${to.join("+")}@example.com>`,
    from: "absender@example.com",
    to,
    subject: "Test",
    text: "Hallo",
    date: new Date("2026-08-29T10:00:00Z"),
    attachments: [],
  };
}

describe("filterToAlias", () => {
  const alias = "hausverwaltung@example.com";

  it("behält Mails, deren To den Alias enthält", () => {
    const hit = makeMail([alias]);
    expect(filterToAlias([hit], alias)).toEqual([hit]);
  });

  it("behält Mails, bei denen der Alias über Cc in to[] gelandet ist (zweite Position)", () => {
    const ccHit = makeMail(["andere.person@example.com", alias]);
    expect(filterToAlias([ccHit], alias)).toEqual([ccHit]);
  });

  it("verwirft Mails ohne Alias-Treffer", () => {
    const miss = makeMail(["privat@example.com", "noch.jemand@example.com"]);
    expect(filterToAlias([miss], alias)).toEqual([]);
  });

  it("vergleicht case-insensitiv (beide Richtungen)", () => {
    const upperTo = makeMail(["HAUSVERWALTUNG@EXAMPLE.COM"]);
    expect(filterToAlias([upperTo], alias)).toEqual([upperTo]);

    const lowerTo = makeMail([alias]);
    expect(filterToAlias([lowerTo], "Hausverwaltung@Example.COM")).toEqual([lowerTo]);
  });

  it("filtert aus gemischter Liste nur die Treffer heraus", () => {
    const hit = makeMail([alias]);
    const miss = makeMail(["privat@example.com"]);
    expect(filterToAlias([miss, hit], alias)).toEqual([hit]);
  });
});
