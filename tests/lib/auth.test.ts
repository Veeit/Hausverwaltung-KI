import { describe, expect, it } from "vitest";
import { AUTH_COOKIE, sha256Hex } from "@/lib/auth";

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
