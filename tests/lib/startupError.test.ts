import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvValidationError } from "@/env";
import { reportStartupError } from "@/lib/startupError";

// Nachstellung des Ersteinrichtungs-Fehlers aus dem Bug-Report: getEnv()
// wirft eine EnvValidationError mit einer fertig aufbereiteten, deutschen
// Sammelmeldung. reportStartupError() ist die Stelle, die Einstiegspunkte
// (Worker, Smoke-Test) beim Scheitern des Starts aufrufen — sie entscheidet,
// ob nur die Meldung oder zusaetzlich das Error-Objekt (samt Stack) an
// console.error geht.
describe("reportStartupError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gibt bei einem Konfigurationsfehler ausschliesslich die aufbereitete Meldung aus, ohne Stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new EnvValidationError(
      "Ungültige oder fehlende Umgebungsvariablen:\n" +
        '  - MAIL_ALIAS: ungültig (aktueller Wert: "hausverwaltung-tool").',
    );

    reportStartupError(err);

    expect(spy).toHaveBeenCalledTimes(1);
    // Nur die Meldung als einziges Argument — kein Error-Objekt/Stack im Schlepptau.
    expect(spy.mock.calls[0]).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(err.message);
  });

  it("behaelt bei einem unerwarteten Fehler das Error-Objekt (samt Stack) fuer die Fehlersuche", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect ECONNREFUSED 127.0.0.1:993");

    reportStartupError(err);

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]!;
    expect(call[0]).toEqual(expect.stringContaining("Unerwarteter Fehler"));
    // Das Error-Objekt selbst (nicht nur seine .message) muss weitergereicht
    // werden, damit console.error dessen Stack ausgibt.
    expect(call[1]).toBe(err);
  });

  it("verwendet einen benutzerdefinierten Praefix, wenn angegeben (z.B. fuer scripts/smoke.ts)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");

    reportStartupError(err, "Smoke-Test fehlgeschlagen");

    expect(spy.mock.calls[0]![0]).toEqual(expect.stringContaining("Smoke-Test fehlgeschlagen"));
  });

  it("unterscheidet Konfigurationsfehler zuverlaessig am Fehlertyp, nicht am Nachrichtentext", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Ein gewoehnlicher Error mit einem Text, der wie eine Konfigurations-
    // meldung aussieht, darf NICHT wie eine EnvValidationError behandelt
    // werden — sonst wuerde am Meldungstext geraten statt am Typ erkannt.
    const lookalike = new Error(
      "Ungültige oder fehlende Umgebungsvariablen:\n  - MAIL_ALIAS: ungültig.",
    );

    reportStartupError(lookalike);

    expect(spy.mock.calls[0]).toHaveLength(2);
    expect(spy.mock.calls[0]![1]).toBe(lookalike);
  });
});
