/**
 * Der Ablauf in vier Schritten. Steht auf der Anmeldeseite und auf der ruhigen
 * Übersicht: Zwischen zwei Anfragen liegen bei einem privaten Vermieter leicht
 * Monate — dann ist eine kurze Auffrischung mehr wert als jede Kennzahl.
 */

const STEPS: { cls: string; title: string; text: string }[] = [
  {
    cls: "av-tenant",
    title: "Mieter schreibt eine E-Mail",
    text: "An Ihre Hausverwaltungs-Adresse — kein Portal, keine App, kein Login.",
  },
  {
    cls: "av-ai",
    title: "Der Assistent klärt die Details",
    text: "Was genau kaputt ist, seit wann, ein Foto und zwei bis drei Terminfenster.",
  },
  {
    cls: "av-landlord",
    title: "Sie entscheiden",
    text: "Ein Klick. Vorher geht nichts an einen Handwerker.",
  },
  {
    cls: "av-contractor",
    title: "Der Handwerker bekommt alles",
    text: "Adresse, Problem, Foto und die Zeiten des Mieters in einer Mail.",
  },
];

export function Steps({ compact = false }: { compact?: boolean }) {
  return (
    <>
      {STEPS.map((step, i) => (
        <div key={step.title} className="step">
          <span className={`step-n ${step.cls}`}>{i + 1}</span>
          <div>
            <p style={{ fontWeight: 700 }}>{step.title}</p>
            <p className="meta" style={compact ? undefined : { maxWidth: "44ch" }}>
              {step.text}
            </p>
          </div>
        </div>
      ))}
    </>
  );
}

export default Steps;
