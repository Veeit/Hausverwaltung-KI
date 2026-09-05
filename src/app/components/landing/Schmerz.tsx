import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Heading } from "./Heading";

function Zeile({ zeit, text, hell = false }: { zeit: string; text: string; hell?: boolean }) {
  return (
    <div className="flex gap-4 sm:gap-[18px]">
      <span
        className={`w-[78px] shrink-0 font-quote text-[16px] ${hell ? "text-accent" : "text-dim"}`}
      >
        {zeit}
      </span>
      <span className={`text-[15px] font-medium sm:text-[16px] ${hell ? "text-ink-soft" : "text-muted-2"}`}>
        {text}
      </span>
    </div>
  );
}

export function Schmerz() {
  return (
    <Section tone="alt">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-4">
          <SectionLabel nr="Abschnitt 02" text="Derselbe Heizungsausfall, zweimal" />
          <Heading>
            Sechs Tage Funkstille
            <br />
            sind keine Verwaltung.
          </Heading>
        </div>

        <div className="grid gap-10 border-t border-rule pt-7 md:grid-cols-2 md:gap-14">
          <div className="flex flex-col gap-4">
            <div className="font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
              Ohne System
            </div>
            <div className="flex flex-col gap-2.5">
              <Zeile zeit="Di, 23:41" text="Die Mail geht raus." />
              <Zeile zeit="Mi — Do" text="Niemand antwortet." />
              <Zeile zeit="Freitag" text="Sie telefonieren drei Handwerkern hinterher." />
              <Zeile zeit="Dienstag" text="Der Termin steht. Endlich." />
            </div>
            <div className="mt-2 font-display text-[44px] leading-none font-black tracking-[-0.04em] text-muted-2 lg:text-[68px]">
              6 Tage
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-rule pt-8 md:border-t-0 md:border-l md:pt-0 md:pl-14">
            <div className="font-mono text-[11px] font-semibold tracking-[0.2em] text-accent uppercase">
              Mit Hausverwaltung KI
            </div>
            <div className="flex flex-col gap-2.5">
              <Zeile zeit="Di, 23:41" text="Die Mail geht raus." hell />
              <Zeile zeit="23:41" text="Die KI antwortet und fragt nach." hell />
              <Zeile zeit="23:42" text="Ihr Klick." hell />
              <Zeile zeit="Mi, 8:05" text="Termin bestätigt, beiden Seiten schriftlich." hell />
            </div>
            <div className="mt-2 font-display text-[44px] leading-none font-black tracking-[-0.04em] text-accent lg:text-[68px]">
              8,5 Std.
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
