"use client";

import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";

export interface ActionState {
  error: string | null;
}

const INITIAL_ACTION_STATE: ActionState = { error: null };

/**
 * Wandelt eine bestehende (weiterhin werfende) Server Action in eine
 * useActionState-taugliche Funktion um: Der Fehler wird abgefangen und als
 * Zustand zurückgegeben, statt die React-Fehlergrenze auszulösen.
 *
 * unstable_rethrow() lässt Next.js-interne Steuersignale (redirect(),
 * notFound()) unverändert durch — würden diese hier als normaler Fehler
 * abgefangen, bräche z.B. der Redirect zu /login nach Session-Ablauf.
 *
 * Die bestehenden Server Actions werfen weiterhin unverändert (siehe z.B.
 * src/app/actions/masterdata.ts) — das hält alle bestehenden Action-Tests
 * (die `.rejects.toThrow(...)` erwarten) unverändert gültig. Diese Funktion
 * ist reine Client-seitige Interop-Schicht, nicht Teil der Server Actions
 * selbst.
 */
export function toActionState(
  action: (formData: FormData) => Promise<void>,
): (prevState: ActionState, formData: FormData) => Promise<ActionState> {
  return async (_prevState, formData) => {
    try {
      await action(formData);
      return { error: null };
    } catch (err) {
      unstable_rethrow(err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Formular-Wrapper, der die deutsche Fehlermeldung einer geworfenen Server
 * Action inline anzeigt, statt den Nutzer auf die globale Error-Boundary
 * (src/app/error.tsx) auflaufen zu lassen, wo im Produktionsbuild ohnehin
 * nur ein generischer englischer Text sichtbar wäre.
 */
export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(toActionState(action), INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className={className} id={id}>
      {children}
      {state.error ? (
        <p className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export default ActionForm;
