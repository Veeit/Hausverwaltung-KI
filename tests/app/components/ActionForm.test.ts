import { describe, expect, it, vi } from "vitest";

// Nachbildung des relevanten Next.js-Verhaltens: unstable_rethrow lässt
// framework-interne Steuersignale (redirect(), notFound()) unverändert durch
// und kehrt für alle anderen Fehler klanglos zurück. Ohne diesen Mock würde
// der echte next/navigation-Import in einer Nicht-Next-Testumgebung fehlschlagen.
vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err && typeof err === "object" && "digest" in err && (err as { digest?: string }).digest === "NEXT_REDIRECT") {
      throw err;
    }
  }),
}));

const { toActionState } = await import("@/app/components/ActionForm");

describe("toActionState", () => {
  it("liefert error: null, wenn die Action erfolgreich durchläuft", async () => {
    const action = vi.fn(async () => {});
    const wrapped = toActionState(action);

    const result = await wrapped({ error: null }, new FormData());

    expect(result).toEqual({ error: null });
    expect(action).toHaveBeenCalledTimes(1);
  });

  // Der Regelfall seit der Umstellung auf das Rückgabewert-Muster (siehe
  // src/lib/actionResult.ts): Die Action WIRFT nicht, sondern gibt einen
  // ActionResult-Wert zurück. Das muss direkt als neuer Zustand übernommen
  // werden — anders als bei einem geworfenen Fehler kommt die Meldung so
  // unverändert durch die Server-Action-Grenze, auch im Produktionsbuild.
  it("übernimmt ein von der Action zurückgegebenes ActionResult direkt als Zustand, statt es abzufangen", async () => {
    const action = vi.fn(async () => ({ error: "Diese E-Mail-Adresse ist bereits vergeben." }));
    const wrapped = toActionState(action);

    const result = await wrapped({ error: null }, new FormData());

    expect(result).toEqual({ error: "Diese E-Mail-Adresse ist bereits vergeben." });
  });

  it("übernimmt ein erfolgreiches ActionResult ({ error: null }) als Zustand", async () => {
    const action = vi.fn(async () => ({ error: null }));
    const wrapped = toActionState(action);

    const result = await wrapped({ error: null }, new FormData());

    expect(result).toEqual({ error: null });
  });

  it("fängt eine geworfene Fehlermeldung ab und liefert sie als Zustand statt zu werfen", async () => {
    const action = vi.fn(async () => {
      throw new Error("Diese E-Mail-Adresse ist bereits vergeben.");
    });
    const wrapped = toActionState(action);

    const result = await wrapped({ error: null }, new FormData());

    expect(result).toEqual({ error: "Diese E-Mail-Adresse ist bereits vergeben." });
  });

  it("wandelt einen nicht-Error-Wurf in einen String um", async () => {
    const action = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "kaputt";
    });
    const wrapped = toActionState(action);

    const result = await wrapped({ error: null }, new FormData());

    expect(result).toEqual({ error: "kaputt" });
  });

  // Kritisch: ein Next.js-internes Steuersignal (z.B. redirect() in
  // requireAuth() nach Session-Ablauf) darf NICHT als gewöhnlicher Fehler
  // abgefangen werden — sonst bräche der Redirect zu /login.
  it("lässt ein Next.js-Redirect-Signal unverändert durch, statt es als Fehlerzustand abzufangen", async () => {
    const redirectSignal = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
    const action = vi.fn(async () => {
      throw redirectSignal;
    });
    const wrapped = toActionState(action);

    await expect(wrapped({ error: null }, new FormData())).rejects.toBe(redirectSignal);
  });
});
