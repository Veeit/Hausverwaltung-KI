/**
 * Abschnitts-Etikett: Nummer in der Akzentfarbe, Halbsatz daneben in Grau.
 * Wiederholt sich über alle Abschnitte und trägt den Rhythmus der Seite.
 */
export function SectionLabel({ nr, text }: { nr: string; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] tracking-[0.2em] uppercase">
      <span className="font-semibold text-accent">{nr}</span>
      <span className="text-dim">{text}</span>
    </div>
  );
}
