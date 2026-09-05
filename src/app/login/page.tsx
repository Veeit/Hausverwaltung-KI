import Link from "next/link";
import { login } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

/**
 * Anmeldeseite. Sie ist nicht mehr der Einstieg — das ist die Landingpage auf
 * / — sondern nur noch die Tür für Leute, die bereits einen Zugang haben.
 * Gestaltet in derselben Sprache wie die Landingpage, damit der Übergang
 * nicht wie ein anderes Produkt wirkt.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen flex-col bg-ground font-display text-ink">
      <header className="border-b border-rule bg-panel">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 px-5 py-4 md:px-11">
          <Link
            href="/"
            className="font-mono text-[12px] font-semibold tracking-[0.24em] text-ink uppercase hover:text-accent"
          >
            Hausmeister KI
          </Link>
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase hover:text-ink"
          >
            ← Zur Startseite
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 py-16">
        <div className="mb-6 flex flex-col gap-3">
          <span className="font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
            Zugang
          </span>
          <h1 className="font-display text-[34px] leading-[0.96] font-black tracking-[-0.03em] uppercase">
            Anmelden.
          </h1>
        </div>

        {params.fehler === "konfiguration" ? (
          <p className="mb-5 border border-rule-strong bg-panel p-3.5 text-[13.5px] leading-normal font-medium text-ink-soft">
            Die Anmeldung ist nicht korrekt konfiguriert: Es ist kein
            DASHBOARD_PASSWORD hinterlegt. Bitte wenden Sie sich an den
            Betreiber und setzen Sie die Umgebungsvariable DASHBOARD_PASSWORD.
          </p>
        ) : params.fehler ? (
          <p className="mb-5 border border-rule-strong bg-panel p-3.5 text-[13.5px] font-medium text-ink-soft">
            Falsches Passwort. Bitte versuchen Sie es erneut.
          </p>
        ) : null}

        <form action={login} className="flex flex-col gap-3">
          <label
            className="font-mono text-[10px] tracking-[0.18em] text-dim uppercase"
            htmlFor="password"
          >
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className="border border-rule bg-panel p-3 text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="bg-accent p-3.5 font-display text-[15px] font-bold text-on-accent hover:bg-accent-hi"
          >
            Anmelden
          </button>
        </form>

        <p className="mt-8 border-t border-rule pt-5 text-[13px] leading-normal font-medium text-muted">
          Noch keinen Zugang? Wir vergeben derzeit keine — tragen Sie sich in
          die{" "}
          <Link href="/#warteliste" className="text-accent hover:text-accent-hi">
            Warteliste
          </Link>{" "}
          ein. Eine Demo des laufenden Systems zeigen wir auf Anfrage.
        </p>
      </div>
    </main>
  );
}
