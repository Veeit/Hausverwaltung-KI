import { Section } from "./Section";

/**
 * Der einzige helle Abschnitt der Seite. Er bricht den dunklen Fluss genau
 * einmal — ein zweiter würde ihn entwerten.
 */
export function Rechnung() {
  return (
    <Section tone="accent">
      <div className="flex flex-col gap-10">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] tracking-[0.2em] uppercase">
          <span className="font-semibold">Abschnitt 05</span>
          <span className="text-on-accent-soft">
            12 Anliegen im Monat, je 25 Minuten Hin und Her — rechnen Sie nach
          </span>
        </div>

        <div className="flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-end lg:gap-12">
          <div className="flex flex-col">
            <span className="font-display text-[92px] leading-[0.82] font-black tracking-[-0.05em] sm:text-[130px] lg:text-[168px]">
              60
            </span>
            <span className="font-display text-[28px] leading-none font-black tracking-[-0.035em] uppercase sm:text-[38px] lg:text-[46px]">
              Stunden im Jahr
            </span>
            <span className="mt-3.5 text-[17px] font-medium text-on-accent-mid lg:text-[19px]">
              tippen Sie das heute selbst. Abends, am Wochenende.
            </span>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3.5 border-t-2 border-on-accent pt-5 lg:w-[400px] lg:border-t-0 lg:border-l-2 lg:pt-0 lg:pl-[26px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14.5px] leading-snug font-medium">
                Klassische Verwaltung
                <br />
                <span className="font-mono text-[10px] tracking-[0.1em] text-on-accent-soft">
                  ~25 € JE EINHEIT IM MONAT
                </span>
              </span>
              <span className="font-display text-[27px] font-black tracking-[-0.025em] whitespace-nowrap text-on-accent-soft">
                6.000 €
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14.5px] leading-snug font-medium">
                PropPilot, Portfolio
                <br />
                <span className="font-mono text-[10px] tracking-[0.1em] text-on-accent-soft">
                  3 € JE EINHEIT IM MONAT
                </span>
              </span>
              <span className="font-display text-[27px] font-black tracking-[-0.025em] whitespace-nowrap">
                720 €
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t-2 border-on-accent pt-3">
              <span className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase">
                Differenz im Jahr
              </span>
              <span className="font-display text-[34px] font-black tracking-[-0.03em] whitespace-nowrap">
                5.280 €
              </span>
            </div>
          </div>
        </div>

        <p className="border-t border-on-accent-soft/40 pt-3.5 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-on-accent-soft uppercase">
          Bei 20 Einheiten. Eine Hausverwaltung leistet mehr als
          Störungsmeldungen — verglichen wird der Teil, den wir übernehmen.
        </p>
      </div>
    </Section>
  );
}
