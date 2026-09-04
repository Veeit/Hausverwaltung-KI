"use client";

import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "@/lib/actionResult";

export interface ActionState {
  error: string | null;
}

const INITIAL_ACTION_STATE: ActionState = { error: null };

function isActionResult(value: unknown): value is ActionResult {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Wandelt eine Server Action in eine useActionState-taugliche Funktion um.
 *
 * Der Regelfall (siehe src/lib/actionResult.ts) ist inzwischen, dass eine
 * Action einen erwartbaren Fehler als ActionResult-Wert ZURÜCKGIBT statt ihn
 * zu werfen — nur so kommt die deutsche Meldung im Produktionsbuild beim
 * Vermieter an (ein geworfener Fehler wird von Next.js auf der Leitung durch
 * einen generischen englischen Text ersetzt, bevor er hier überhaupt ankommt;
 * ein rein clientseitiger try/catch kann das NICHT reparieren, weil die
 * Ersetzung schon auf dem Transport passiert ist). Ein zurückgegebenes
 * ActionResult wird deshalb direkt als neuer Zustand übernommen.
 *
 * Für Actions, die (noch) nicht auf das Rückgabewert-Muster umgestellt sind
 * (z.B. weil sie außerhalb des Fokus dieses Fixes liegen), bleibt der
 * try/catch als Rückfallebene bestehen — das ändert an deren Verhalten
 * nichts gegenüber vorher.
 *
 * unstable_rethrow() lässt Next.js-interne Steuersignale (redirect(),
 * notFound()) unverändert durch — würden diese hier als normaler Fehler
 * abgefangen, bräche z.B. der Redirect zu /login nach Session-Ablauf.
 */
export function toActionState(
  action: (formData: FormData) => Promise<ActionResult | void>,
): (prevState: ActionState, formData: FormData) => Promise<ActionState> {
  return async (_prevState, formData) => {
    try {
      const result = await action(formData);
      if (isActionResult(result)) {
        return { error: result.error };
      }
      return { error: null };
    } catch (err) {
      unstable_rethrow(err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Formular-Wrapper, der die deutsche Fehlermeldung einer Server Action inline
 * anzeigt, statt den Nutzer auf die globale Error-Boundary (src/app/error.tsx)
 * auflaufen zu lassen, wo im Produktionsbuild ohnehin nur ein generischer
 * englischer Text sichtbar wäre.
 */
export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (formData: FormData) => Promise<ActionResult | void>;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(toActionState(action), INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className={className} id={id}>
      {children}
      {state.error ? (
        <p className="err" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export default ActionForm;
