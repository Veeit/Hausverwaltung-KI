/**
 * Schlagzeile eines Abschnitts. Eine Größe für alle — die Hierarchie
 * entsteht über die Abschnittsfolge, nicht über wechselnde Grade.
 */
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[30px] leading-[0.96] font-black tracking-[-0.03em] text-ink uppercase sm:text-[40px] lg:text-[56px] lg:leading-[0.94] lg:tracking-[-0.035em]">
      {children}
    </h2>
  );
}
