import { Section } from "./Section";
import { Heading } from "./Heading";

function Einwand({
  frage,
  antwort,
  letzte = false,
}: {
  frage: string;
  antwort: React.ReactNode;
  letzte?: boolean;
}) {
  return (
    <div
      className={`grid items-baseline gap-3 border-t border-rule py-5 lg:grid-cols-[490px_minmax(0,1fr)] lg:gap-10 ${letzte ? "border-b" : ""}`}
    >
      <span className="font-quote text-[23px] leading-tight sm:text-[28px]">{frage}</span>
      <span className="text-[16px] leading-normal font-medium text-muted sm:text-[17px]">
        {antwort}
      </span>
    </div>
  );
}

export function Einwaende() {
  return (
    <Section>
      <div className="flex flex-col gap-9">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <Heading>Ja, aber.</Heading>
          <span className="font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
            Abschnitt 06 — die vier Fragen, die jeder zuerst stellt
          </span>
        </div>

        <div className="flex flex-col">
          <Einwand
            frage="„Die KI schreibt meinen Mietern Unsinn.“"
            antwort="Sie lesen jeden Vorgang mit. Und was Geld kostet, hängt an Ihrem Klick."
          />
          <Einwand
            frage="„Meine Mieter installieren keine App.“"
            antwort="Müssen sie nicht. Es ist eine E-Mail-Adresse, sonst nichts."
          />
          <Einwand
            frage="„Und die Daten meiner Mieter?“"
            antwort={
              <>
                Ihr Postfach, Ihre Datenbank. Nach außen geht nur der
                Nachrichtentext. <span className="text-dim">[AVV]</span>
              </>
            }
          />
          <Einwand
            frage="„Was, wenn es wirklich brennt?“"
            antwort="Dann die 112. Genau das antwortet die KI auch."
            letzte
          />
        </div>
      </div>
    </Section>
  );
}
