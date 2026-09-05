import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Heading } from "./Heading";

function Sperre({ nr, text, letzte = false }: { nr: string; text: string; letzte?: boolean }) {
  return (
    <div
      className={`flex items-baseline gap-5 border-t border-rule py-5 sm:gap-[26px] ${letzte ? "border-b" : ""}`}
    >
      <span className="w-[34px] shrink-0 font-mono text-[12px] tracking-[0.2em] text-dim">
        {nr}
      </span>
      <span className="text-[19px] font-medium tracking-[-0.015em] sm:text-[22px] lg:text-[25px]">
        {text}
      </span>
    </div>
  );
}

export function Sicherheit() {
  return (
    <Section id="sicherheit" tone="alt">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <SectionLabel nr="Abschnitt 04" text="Drei Sperren, im Code, nicht im Prompt" />
          <Heading>
            Die KI kann nichts tun,
            <br />
            was Sie nicht angeklickt haben.
          </Heading>
        </div>

        <div className="flex flex-col">
          <Sperre nr="01" text="Mails gehen nur an Adressen, die bei Ihnen im System stehen." />
          <Sperre nr="02" text="Zum Handwerker geht nichts ohne Ihren Klick." />
          <Sperre nr="03" text="Über 20 Mails in einer Stunde: das System hält von selbst an." letzte />
        </div>
      </div>
    </Section>
  );
}
