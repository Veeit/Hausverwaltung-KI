import { describe, expect, it } from "vitest";
import { AUTH_COOKIE, getExpectedAuthCookie, sha256Hex } from "@/lib/auth";

describe("auth-Helfer", () => {
  it("AUTH_COOKIE heißt hv_auth", () => {
    expect(AUTH_COOKIE).toBe("hv_auth");
  });

  it("sha256Hex('test') liefert den bekannten SHA-256-Vektor", async () => {
    expect(await sha256Hex("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  it("sha256Hex liefert 64 Hex-Zeichen und unterscheidet Eingaben", async () => {
    const a = await sha256Hex("passwort-a");
    const b = await sha256Hex("passwort-b");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("getExpectedAuthCookie (fail-closed)", () => {
  it("liefert null, wenn die Variable nicht gesetzt ist (undefined)", async () => {
    expect(await getExpectedAuthCookie(undefined)).toBeNull();
  });

  it("liefert null bei leerem String", async () => {
    expect(await getExpectedAuthCookie("")).toBeNull();
  });

  it("liefert null bei einem Wert, der nur aus Leerraum besteht", async () => {
    expect(await getExpectedAuthCookie("   ")).toBeNull();
    expect(await getExpectedAuthCookie("\t\n")).toBeNull();
  });

  it("liefert NICHT den Hash von sha256('') als Ersatzwert", async () => {
    const emptyHash = await sha256Hex("");
    const result = await getExpectedAuthCookie("");
    expect(result).not.toBe(emptyHash);
    expect(result).toBeNull();
  });

  it("liefert sha256Hex(passwort) bei einem gesetzten, nicht-leeren Passwort", async () => {
    const expected = await getExpectedAuthCookie("mein-geheimes-passwort");
    expect(expected).toBe(await sha256Hex("mein-geheimes-passwort"));
  });
});
