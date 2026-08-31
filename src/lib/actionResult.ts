/**
 * Rückgabetyp für Server Actions, die einen erwartbaren Fehlerfall
 * (Validierung, Konflikt, falscher Status, leere Eingabe) NICHT werfen,
 * sondern als Wert zurückgeben.
 *
 * Hintergrund: Next.js ersetzt die Meldung eines von einer Server Action
 * GEWORFENEN Fehlers im Produktionsbuild auf der Leitung durch einen
 * generischen englischen Text (nur ein "digest" bleibt zur Zuordnung im
 * Server-Log übrig) — die deutsche Meldung kommt beim Vermieter nie an,
 * unabhängig davon, ob der Aufrufer sie clientseitig abzufangen versucht
 * (das serialisierte Ergebnis enthält den Klartext schlicht nicht mehr).
 * Das Rückgabewert-Muster (siehe React/Next.js: useActionState) umgeht das:
 * der Fehler verlässt die Server Action als normale Nutzdaten, nicht als
 * geworfene Exception, und wird von src/app/components/ActionForm.tsx inline
 * im Formular angezeigt.
 *
 * Für wirklich UNERWARTETE Fehler (Bugs, kaputte SMTP-Verbindung, DB down)
 * wird bewusst weiterhin geworfen — die landen auf der globalen
 * Error-Boundary (src/app/error.tsx), die genau dafür da ist.
 */
export interface ActionResult {
  error: string | null;
}

export const OK: ActionResult = { error: null };

export function fail(message: string): ActionResult {
  return { error: message };
}
