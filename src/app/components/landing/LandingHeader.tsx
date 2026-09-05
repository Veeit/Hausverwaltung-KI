import Link from "next/link";

/**
 * Kopfzeile der Landingpage.
 *
 * Der Zugangs-Knopf ist bewusst nur umrandet, nicht in der Akzentfarbe: Blau
 * ist der einen Hauptaktion vorbehalten ("Auf die Warteliste"). Wer
 * bereits angemeldet ist, sieht hier stattdessen den Weg ins Dashboard.
 */
export function LandingHeader({ angemeldet }: { angemeldet: boolean }) {
  return (
    <header className="border-b border-rule bg-panel">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-11">
        <span className="font-mono text-[12px] font-semibold tracking-[0.24em] text-ink uppercase">
          PropPilot
        </span>
        <nav className="flex items-center gap-4 font-mono text-[11px] tracking-[0.14em] text-muted uppercase sm:gap-6">
          <a href="#ablauf" className="hidden min-h-11 items-center text-muted hover:text-ink sm:inline-flex">
            Ablauf
          </a>
          <a href="#sicherheit" className="hidden min-h-11 items-center text-muted hover:text-ink sm:inline-flex">
            Sicherheit
          </a>
          <a href="#preise" className="hidden min-h-11 items-center text-muted hover:text-ink sm:inline-flex">
            Preise
          </a>
          <a
            href="#warteliste"
            className="inline-flex min-h-11 items-center font-semibold text-accent hover:text-accent-hi"
          >
            Warteliste
          </a>
          <Link
            href={angemeldet ? "/app" : "/login"}
            className="inline-flex min-h-11 items-center border border-rule-strong px-3 font-semibold text-ink hover:border-muted"
          >
            {angemeldet ? "Zum Dashboard" : "Anmelden"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
