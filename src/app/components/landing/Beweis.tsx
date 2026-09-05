import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Heading } from "./Heading";

function Schritt({
  marke,
  markeMono = false,
  titel,
  children,
}: {
  marke: string;
  markeMono?: boolean;
  titel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span
        className={
          markeMono
            ? "font-mono text-[11px] tracking-[0.18em] text-dim uppercase"
            : "font-quote text-[16px] text-accent"
        }
      >
        {marke}
      </span>
      <span className="font-display text-[19px] leading-tight font-extrabold tracking-[-0.02em] uppercase">
        {titel}
      </span>
      {children}
    </div>
  );
}

export function Beweis() {
  return (
    <Section id="ablauf">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-4">
          <SectionLabel nr="Abschnitt 03" text="Was nach Ihrem Klick passiert" />
          <Heading>
            Ab hier macht das
            <br />
            System weiter. Ohne Sie.
          </Heading>
        </div>

        <div className="grid gap-8 border-t border-rule pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Schritt marke="23:42" titel="Anfrage raus">
            <p className="text-[15px] leading-normal font-medium text-muted">
              Der Handwerker bekommt Ihren Entwurf samt Terminfenstern.
            </p>
          </Schritt>
          <Schritt marke="Mi, 8:05" titel="Er antwortet">
            <p className="font-quote text-[18px] leading-snug text-ink-soft">
              &bdquo;Kann heute um 9:15 vorbeikommen.&ldquo;
            </p>
          </Schritt>
          <Schritt marke="Mi, 8:05" titel="Abgleich">
            <p className="text-[15px] leading-normal font-medium text-muted">
              Passt ins Fenster. Die KI bestätigt beiden Seiten.
            </p>
          </Schritt>
          <Schritt marke="Sonst" markeMono titel="Eskalation">
            <p className="text-[15px] leading-normal font-medium text-muted">
              Passt er nicht, landet der Fall bei Ihnen — nicht im Nirgendwo.
            </p>
          </Schritt>
        </div>
      </div>
    </Section>
  );
}
