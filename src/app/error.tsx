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
 * angezeigt. Diese Seite fängt nur den Absturz selbst ab und bietet einen Weg
 * zurück. Für Formulare, bei denen Fehler im Alltag regelmäßig auftreten,
 * zeigen die Formulare selbst die konkrete deutsche Meldung inline an (siehe
 * ActionForm) — ohne dass es überhaupt zu diesem Bildschirm kommt.
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
    <main className="main main-narrow">
      <section className="card">
        <div className="empty">
          <span className="empty-mark" style={{ background: "var(--signal-soft)", color: "var(--signal)" }}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.6l9.2 15.9H2.8z" />
              <path d="M12 9.6v4.3M11.9 16.7h.2" />
            </svg>
          </span>
          <h2 style={{ fontSize: "22px" }}>Etwas ist schiefgelaufen</h2>
          <p className="lead" style={{ maxWidth: "48ch" }}>
            Bei der Verarbeitung ist ein unerwarteter Fehler aufgetreten. Es wurden
            keine Daten verändert; Sie können es erneut versuchen oder zur Übersicht
            zurückkehren.
          </p>
          {error.digest ? <p className="meta">Fehlerkennung: {error.digest}</p> : null}
          <div className="row-wrap" style={{ justifyContent: "center" }}>
            <button type="button" onClick={() => reset()} className="btn btn-primary">
              Erneut versuchen
            </button>
            <Link href="/" className="btn btn-ghost">
              Zur Übersicht
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
