function Kennzahl({ nr, wert, text, accent = false }: { nr: string; wert: string; text: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-rule pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
      <span className="font-mono text-[10px] tracking-[0.18em] text-dim uppercase">{nr}</span>
      <span
        className={`font-display text-[24px] leading-none font-extrabold tracking-[-0.02em] lg:text-[27px] ${accent ? "text-accent" : "text-ink"}`}
      >
        {wert}
      </span>
      <span className="text-[12.5px] leading-snug font-medium text-muted">{text}</span>
    </div>
  );
}

export function Hero() {
  return (
    <section className="bg-ground px-5 pt-8 pb-12 md:px-11 md:pt-8 md:pb-11">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[11px] tracking-[0.2em] uppercase">
          <span className="bg-rule px-2 py-1 font-semibold text-ink">Vorgang HV-118</span>
          <span className="text-dim">
            Eingang 23:41 Uhr — Bearbeitung 23:41 Uhr — Freigabe 23:42 Uhr
          </span>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_392px] lg:gap-[42px]">
          <div className="flex flex-col gap-6">
            <h1 className="font-display text-[34px] leading-[0.96] font-black tracking-[-0.03em] text-ink uppercase sm:text-[44px] lg:text-[50px] lg:leading-[0.94] lg:tracking-[-0.032em]">
              Ihr Mieter
              <br />
              schreibt um 23:41.
              <br />
              Um{" "}
              <span className="font-quote text-[38px] font-normal tracking-[-0.01em] text-accent normal-case italic sm:text-[50px] lg:text-[56px]">
                23:42
              </span>{" "}
              weiss der
              <br />
              Handwerker Bescheid.
            </h1>

            <p className="max-w-[600px] text-[15px] leading-relaxed font-medium text-muted sm:text-[16px]">
              Eine KI führt den Dialog und legt Ihnen den fertigen
              Handwerker-Auftrag zum Freigeben hin. Sie klicken. Sonst passiert
              nichts. — Wir sind noch nicht offen: derzeit Warteliste, Demo auf
              Anfrage.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <a
                href="#warteliste"
                className="bg-accent px-7 py-4 font-display text-[15px] font-bold text-on-accent hover:bg-accent-hi"
              >
                Auf die Warteliste
              </a>
              <a
                href="#ablauf"
                className="inline-flex min-h-11 items-end border-b-2 border-rule-strong pb-1 font-mono text-[11.5px] tracking-[0.14em] text-muted uppercase hover:text-ink"
              >
                Ablauf ansehen
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="font-mono text-[10px] tracking-[0.2em] text-dim uppercase">
              Protokoll — heute Nacht
            </div>

            <div className="flex flex-col gap-1.5 border border-rule bg-panel px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] tracking-[0.16em] text-dim uppercase">
                  Mieterin — Whg. 4
                </span>
                <span className="font-mono text-[11px] text-dim">23:41</span>
              </div>
              <p className="font-quote text-[17px] leading-snug text-ink-soft">
                &bdquo;Die Heizung im Wohnzimmer bleibt kalt, seit heute
                Nachmittag. Es sind 14 Grad.&ldquo;
              </p>
            </div>

            <div className="flex flex-col gap-1.5 border border-rule border-l-[3px] border-l-accent bg-panel px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] tracking-[0.16em] text-accent uppercase">
                  KI — Antwort
                </span>
                <span className="font-mono text-[11px] text-dim">23:41</span>
              </div>
              <p className="font-quote text-[17px] leading-snug text-ink-soft">
                &bdquo;Bei 14 Grad ist das dringend. Sind die anderen Räume warm?
                Und wann passt Ihnen ein Termin?&ldquo;
              </p>
            </div>

            <div className="flex flex-col gap-2.5 border border-rule-hi bg-panel-hi px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
                  Ihre Freigabe
                </span>
                <span className="font-mono text-[11px] text-dim">23:42</span>
              </div>
              <p className="text-[14px] leading-normal font-medium text-ink-soft">
                <span className="font-semibold text-ink">Krause Sanitär</span>{" "}
                beauftragen? Terminfenster Mi 8–12 und Do ab 16 Uhr stehen im
                Entwurf.
              </p>
              <div className="flex gap-2">
                <span className="bg-accent px-4 py-2 font-display text-[12.5px] font-bold text-on-accent">
                  Freigeben
                </span>
                <span className="border border-rule-strong px-4 py-2 font-display text-[12.5px] font-medium text-muted">
                  Ablehnen
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <div className="-rotate-6 border-[3px] border-stamp px-3.5 py-1.5 text-center text-ink-soft">
                <div className="font-display text-[21px] leading-none font-black tracking-[0.01em]">
                  FREIGEGEBEN
                </div>
                <div className="mt-1 font-mono text-[9px] tracking-[0.18em]">
                  23:42 UHR — 1 KLICK
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t-2 border-rule-strong pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Kennzahl nr="Feld 01" wert="< 60 Sek." text="bis zur ersten Antwort, auch nachts" />
          <Kennzahl nr="Feld 02" wert="0 Aufträge" text="gehen raus, die Sie nicht angeklickt haben" accent />
          <Kennzahl nr="Feld 03" wert="Keine App" text="Ihre Mieter schreiben eine normale E-Mail" />
          <Kennzahl nr="Feld 04" wert="5 Std." text="Hin und Her im Monat weniger" />
        </div>
      </div>
    </section>
  );
}
