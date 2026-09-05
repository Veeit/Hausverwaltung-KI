import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Heading } from "./Heading";

function Tarif({
  nr,
  name,
  fuer,
  preis,
  einheit,
  merkmale,
  cta,
  hervorgehoben = false,
}: {
  nr: string;
  name: string;
  fuer: string;
  preis: string;
  einheit?: string;
  merkmale: string[];
  cta: string;
  hervorgehoben?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col gap-4.5 p-6 ${
        hervorgehoben ? "border-2 border-accent bg-panel-hi" : "border border-rule bg-panel"
      }`}
    >
      {hervorgehoben ? (
        <span className="absolute -top-px -right-px bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.18em] text-on-accent uppercase">
          Beliebteste
        </span>
      ) : null}

      <div className="flex flex-col gap-2">
        <span
          className={`font-mono text-[11px] tracking-[0.2em] uppercase ${hervorgehoben ? "font-semibold text-accent" : "text-dim"}`}
        >
          {nr}
        </span>
        <span className="font-display text-[24px] font-black tracking-[-0.025em] uppercase">
          {name}
        </span>
        <span className="text-[13.5px] font-medium text-muted">{fuer}</span>
      </div>

      <div
        className={`flex items-baseline gap-2 border-y py-4 ${hervorgehoben ? "border-rule-hi" : "border-rule"}`}
      >
        <span
          className={`font-display font-black tracking-[-0.035em] ${einheit ? "text-[44px]" : "text-[34px] tracking-[-0.03em]"} ${hervorgehoben ? "text-accent" : ""}`}
        >
          {preis}
        </span>
        {einheit ? (
          <span
            className={`font-mono text-[11.5px] tracking-[0.1em] ${hervorgehoben ? "text-muted" : "text-dim"}`}
          >
            {einheit}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5 text-[13.5px] leading-snug font-medium">
        {merkmale.map((m) => (
          <li key={m} className={hervorgehoben ? "text-ink-soft" : "text-muted"}>
            {m}
          </li>
        ))}
      </ul>

      <a
        href="#warteliste"
        className={`mt-auto flex min-h-11 items-center justify-center py-3.5 text-center font-display text-[14px] font-bold ${
          hervorgehoben
            ? "bg-accent text-on-accent hover:bg-accent-hi"
            : "border border-rule-strong text-ink hover:border-muted"
        }`}
      >
        {cta}
      </a>
    </div>
  );
}

export function Preise() {
  return (
    <Section id="preise" tone="alt">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-10">
          <div className="flex flex-col gap-4">
            <SectionLabel nr="Abschnitt 07" text="Geplante Preise zum Start — noch nicht buchbar" />
            <Heading>Preise.</Heading>
          </div>
          <p className="max-w-[340px] text-[14.5px] leading-normal font-medium text-muted">
            Sie zahlen für Einheiten — nicht für Nutzer, nicht pro Nachricht.
            Die Zahlen stehen hier, damit Sie sich einordnen können, bevor Sie
            sich eintragen.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <Tarif
            nr="Tarif 01"
            name="Solo"
            fuer="Für die eigenen paar Wohnungen, die Sie selbst verwalten."
            preis="29 €"
            einheit="/ Monat"
            merkmale={[
              "Bis 10 Einheiten",
              "Unbegrenzt viele Vorgänge",
              "Dashboard, Genehmigungen, Eskalationen",
              "Ihr eigenes Postfach, Ihre eigenen Handwerker",
            ]}
            cta="Vormerken"
          />
          <Tarif
            nr="Tarif 02"
            name="Portfolio"
            fuer="Ab dem Punkt, wo die Abende nicht mehr reichen."
            preis="3 €"
            einheit="/ Einheit / Monat"
            merkmale={[
              "Ab 10 Einheiten",
              "Alles aus Solo",
              "Mehrere Objekte und Handwerker-Gewerke",
              "Dokumente als Wissensquelle für die KI",
              "Vorrang bei Rückfragen",
            ]}
            cta="Vormerken"
            hervorgehoben
          />
          <Tarif
            nr="Tarif 03"
            name="Verwaltung"
            fuer="Für Häuser, die das für andere machen."
            preis="Auf Anfrage"
            merkmale={[
              "Ab 250 Einheiten",
              "Alles aus Portfolio",
              "Mehrere Bearbeiter mit eigenen Zugängen",
              "Eigene Domain für das Mieter-Postfach",
              "Betrieb auf Ihren Servern möglich",
            ]}
            cta="Vormerken"
          />
        </div>

        <div className="flex flex-wrap justify-between gap-4 border-t border-rule pt-4 font-mono text-[10px] tracking-[0.16em] text-dim uppercase">
          <span>Preise noch nicht endgültig — zzgl. USt.</span>
          <span>Einheit = eine vermietete Wohnung</span>
        </div>
      </div>
    </Section>
  );
}
