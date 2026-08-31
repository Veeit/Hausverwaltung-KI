import { describe, it, expect } from "vitest";
import { buildTicketTag, ensureTag, extractTicketId } from "@/lib/subject";

describe("buildTicketTag", () => {
  it('baut "[HV-12]" aus der Id 12', () => {
    expect(buildTicketTag(12)).toBe("[HV-12]");
  });

  it('baut "[HV-1]" aus der Id 1', () => {
    expect(buildTicketTag(1)).toBe("[HV-1]");
  });
});

describe("extractTicketId", () => {
  it("findet den Tag in einem normalen Betreff", () => {
    expect(extractTicketId("Re: Türschloss defekt [HV-12]")).toBe(12);
  });

  it("ist case-insensitiv ([hv-7], [Hv-7])", () => {
    expect(extractTicketId("AW: Terminvorschlag [hv-7]")).toBe(7);
    expect(extractTicketId("AW: Terminvorschlag [Hv-7]")).toBe(7);
  });

  it("liefert null bei fehlendem Tag, leerem String, null und undefined", () => {
    expect(extractTicketId("Türschloss defekt")).toBeNull();
    expect(extractTicketId("")).toBeNull();
    expect(extractTicketId(null)).toBeNull();
    expect(extractTicketId(undefined)).toBeNull();
  });

  it("nimmt bei mehreren Tags die erste Fundstelle", () => {
    expect(extractTicketId("[HV-3] Re: [HV-7]")).toBe(3);
  });

  it("ignoriert kaputte Tags ohne Zahl", () => {
    expect(extractTicketId("[HV-] und [HV-abc]")).toBeNull();
  });
});

describe("ensureTag", () => {
  it("hängt den Tag mit führendem Leerzeichen an, wenn keiner vorhanden ist", () => {
    expect(ensureTag("Türschloss defekt", 12)).toBe("Türschloss defekt [HV-12]");
  });

  it("ist idempotent: vorhandener Tag mit derselben Id wird nicht doppelt angehängt", () => {
    expect(ensureTag("Türschloss defekt [HV-12]", 12)).toBe("Türschloss defekt [HV-12]");
  });

  it("hängt auch dann NICHT an, wenn bereits ein Tag mit ANDERER Id vorhanden ist", () => {
    expect(ensureTag("Re: [HV-3] Terminvorschlag", 12)).toBe("Re: [HV-3] Terminvorschlag");
  });

  it("erkennt vorhandene Tags case-insensitiv", () => {
    expect(ensureTag("Re: [hv-12] Terminvorschlag", 12)).toBe("Re: [hv-12] Terminvorschlag");
  });
});
