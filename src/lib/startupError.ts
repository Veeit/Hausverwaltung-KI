import { EnvValidationError } from "@/env";

// Gemeinsame Fehlerbehandlung fuer Einstiegspunkte (Worker, Smoke-Test), die
// getEnv() beim Start aufrufen und deren Startfehler nicht als roher
// Stacktrace in der Konsole landen sollen.
//
// Ein Konfigurationsfehler (EnvValidationError) enthaelt bereits eine
// vollstaendige, lesbare deutsche Sammelmeldung — der Betreiber muss nur die
// .env korrigieren, ein Stacktrace waere hier nur Rauschen und wuerde vom
// eigentlichen Problem ablenken. Bei jedem anderen, unerwarteten Fehler
// (z. B. ein Netzwerkproblem beim IMAP-Verbindungsaufbau) bleibt das
// Error-Objekt samt Stack erhalten, weil es fuer die Fehlersuche wertvoll
// ist. Die Unterscheidung erfolgt bewusst am Fehlertyp (instanceof), nicht
// am Text der Meldung — das bleibt auch dann zuverlaessig, wenn sich
// Meldungstexte spaeter aendern.
export function reportStartupError(
  err: unknown,
  prefix = "[worker] Unerwarteter Fehler beim Start",
): void {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
  } else {
    console.error(`${prefix}:`, err);
  }
}
