"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Globale Error-Boundary für das Dashboard (Next.js App Router: error.tsx
 * fängt jeden nicht abgefangenen Fehler beim Rendern einer Seite ab).
 *
 * Wichtig: Im Produktionsbuild ersetzt Next.js die Fehlermeldung serverseitig
 * geworfener Fehler durch einen generischen, englischen Text (nur ein
 * "digest" bleibt zur Zuordnung im Server-Log) — error.message ist hier also
 * bewusst NICHT verlässlich für den Nutzer lesbar und wird deshalb nicht
 * angezeigt. Diese Seite fängt nur den Absturz selbst ab (statt des
 * Next.js-Standardbildschirms) und bietet einen Weg zurück. Für Formulare,
 * bei denen Fehler im Alltag regelmäßig auftreten (Stammdaten,
 * Dokumenten-Upload, Genehmigungen), zeigen die Formulare selbst die
 * konkrete deutsche Meldung inline an (siehe ActionForm-Komponente) — ohne
 * dass es dafür überhaupt zu diesem Absturzbildschirm kommt.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] Unbehandelter Fehler beim Rendern:", error);
  }, [error]);

  return (
    <main className="mx-auto mt-24 max-w-md rounded border border-red-200 bg-white p-6 text-center shadow-sm">
      <h1 className="mb-2 text-xl font-semibold text-red-800">
        Etwas ist schiefgelaufen
      </h1>
      <p className="mb-1 text-sm text-gray-700">
        Bei der Verarbeitung ist ein unerwarteter Fehler aufgetreten. Es
        wurden keine Daten verändert; Sie können es erneut versuchen oder zur
        Übersicht zurückkehren.
      </p>
      {error.digest ? (
        <p className="mb-4 text-xs text-gray-400">Fehlerkennung: {error.digest}</p>
      ) : (
        <p className="mb-4" />
      )}
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Erneut versuchen
        </button>
        <Link
          href="/app"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
