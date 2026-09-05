import Link from "next/link";
import { WaitlistForm } from "./WaitlistForm";

export function Abschluss() {
  return (
    <footer id="warteliste" className="bg-ground">
      <div className="mx-auto max-w-[1240px] px-5 py-14 md:px-11 md:py-16">
        <div className="flex flex-col justify-between gap-10 lg:flex-row lg:items-start lg:gap-14">
          <div className="flex flex-col gap-5 lg:pt-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[11px] tracking-[0.2em] uppercase">
              <span className="bg-rule px-2 py-1 font-semibold text-ink">Vorgang HV-119</span>
              <span className="text-dim">Eingang steht noch aus</span>
            </div>
            <h2 className="font-display text-[34px] leading-[0.96] font-black tracking-[-0.03em] uppercase sm:text-[44px] lg:text-[50px] lg:leading-[0.94]">
              Ihr nächster Mieter
              <br />
              schreibt{" "}
              <span className="font-quote text-[38px] font-normal tracking-[-0.01em] text-accent normal-case italic sm:text-[50px] lg:text-[56px]">
                heute Nacht
              </span>
              .
            </h2>
            <p className="max-w-[520px] text-[15px] leading-relaxed font-medium text-muted sm:text-[16px]">
              Wir vergeben noch keine Zugänge. Tragen Sie sich ein — dann
              melden wir uns, sobald wir öffnen. Wer es vorher sehen will:
              Das System läuft bereits, wir zeigen es auf Anfrage.
            </p>
            <Link
              href="/login"
              className="inline-flex min-h-11 w-fit items-center border-b border-rule pb-1 font-mono text-[11px] tracking-[0.14em] text-muted uppercase hover:text-ink"
            >
              Ich habe bereits Zugang →
            </Link>
          </div>

          <div className="w-full shrink-0 border border-rule bg-ground-alt p-6 lg:w-[400px]">
            <WaitlistForm />
          </div>
        </div>
      </div>

      <div className="border-t border-rule bg-ground-deep">
        <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-8 px-5 py-6 md:flex-row md:px-11">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[12px] font-semibold tracking-[0.24em] text-ink uppercase">
              Hausmeister KI
            </span>
            <span className="max-w-[420px] text-[12.5px] leading-normal font-medium text-dim">
              KI-gestützte Hausverwaltung per E-Mail. Derzeit ein
              Vorführsystem — noch nicht zu buchen.
            </span>
          </div>
          <div className="flex gap-11 font-mono text-[11px] tracking-[0.14em] text-dim uppercase">
            <div className="flex flex-col">
              <span className="flex min-h-11 items-center text-muted">Produkt</span>
              <a href="#ablauf" className="flex min-h-11 items-center hover:text-ink">Ablauf</a>
              <a href="#sicherheit" className="flex min-h-11 items-center hover:text-ink">Sicherheit</a>
              <a href="#preise" className="flex min-h-11 items-center hover:text-ink">Preise</a>
            </div>
            <div className="flex flex-col">
              <span className="flex min-h-11 items-center text-muted">Rechtliches</span>
              <span className="flex min-h-11 items-center">[Impressum]</span>
              <span className="flex min-h-11 items-center">[Datenschutz]</span>
              <span className="flex min-h-11 items-center">[Kontakt]</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
