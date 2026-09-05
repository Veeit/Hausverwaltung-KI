/**
 * Gemeinsamer Rahmen aller Abschnitte: volle Breite, Inhalt auf 1240 px
 * begrenzt, einheitliche Innenabstände.
 */
export function Section({
  id,
  tone = "ground",
  className = "",
  children,
}: {
  id?: string;
  tone?: "ground" | "alt" | "accent";
  className?: string;
  children: React.ReactNode;
}) {
  const bg =
    tone === "accent"
      ? "bg-accent text-on-accent"
      : tone === "alt"
        ? "bg-ground-alt text-ink"
        : "bg-ground text-ink";
  return (
    <section id={id} className={`${bg} px-5 py-14 md:px-11 md:py-16 ${className}`}>
      <div className="mx-auto max-w-[1240px]">{children}</div>
    </section>
  );
}
