"use client";

import { useActionState } from "react";
import { joinWaitlist } from "@/app/actions/waitlist";
import { UNIT_BUCKETS, UNIT_BUCKET_LABELS, WAITLIST_INITIAL } from "@/lib/waitlist";

/**
 * Das einzige Formular der Seite. Alle Handlungsaufforderungen weiter oben
 * zeigen hierher (#warteliste) — eine Hauptaktion, mehrfach angeboten.
 *
 * Erfolg und Fehler erscheinen an Ort und Stelle, ohne Seitenwechsel; das
 * ActionForm des Dashboards kann nur Fehler anzeigen, deshalb hier ein
 * eigener useActionState.
 */
export function WaitlistForm() {
  const [state, formAction, pending] = useActionState(joinWaitlist, WAITLIST_INITIAL);

  if (state.ok) {
    return (
      <div
        className="flex flex-col gap-2 border border-accent bg-panel-hi p-5"
        role="status"
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-accent uppercase">
          Eingetragen
        </span>
        <p className="text-[15px] leading-normal font-medium text-ink">
          Sie stehen auf der Liste. Wir melden uns, sobald wir Zugänge
          vergeben — und vorher nicht.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {/* Köderfeld gegen einfache Bots: für Menschen unsichtbar und aus der
          Tabulator-Reihenfolge genommen. Wer es ausfüllt, ist keiner. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 overflow-hidden opacity-0"
      />

      <label className="font-mono text-[10px] tracking-[0.18em] text-dim uppercase" htmlFor="wl-email">
        E-Mail-Adresse
      </label>
      <input
        id="wl-email"
        name="email"
        type="email"
        required
        maxLength={254}
        placeholder="sie@ihre-domain.de"
        className="min-h-11 border border-rule bg-panel px-3 py-2.5 text-[15px] text-ink placeholder:text-dim focus:border-accent focus:outline-none"
      />

      <label className="mt-1 font-mono text-[10px] tracking-[0.18em] text-dim uppercase" htmlFor="wl-units">
        Wie viele Einheiten verwalten Sie?
      </label>
      <select
        id="wl-units"
        name="units"
        defaultValue=""
        className="min-h-11 border border-rule bg-panel px-3 py-2.5 text-[15px] text-ink focus:border-accent focus:outline-none"
      >
        <option value="">Keine Angabe</option>
        {UNIT_BUCKETS.map((b) => (
          <option key={b} value={b}>
            {UNIT_BUCKET_LABELS[b]}
          </option>
        ))}
      </select>

      <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] leading-snug font-medium text-ink-soft">
        <input
          type="checkbox"
          name="demo"
          className="h-4 w-4 shrink-0 accent-[#7cb8e8]"
        />
        Ich möchte vorher eine Demo des laufenden Systems sehen.
      </label>

      {state.error ? (
        <p
          className="border border-rule-strong bg-panel p-3 text-[13.5px] font-medium text-ink-soft"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 bg-accent py-4 font-display text-[16px] font-bold text-on-accent hover:bg-accent-hi disabled:opacity-60"
      >
        {pending ? "Wird eingetragen …" : "Auf die Warteliste"}
      </button>

      <p className="text-[12px] leading-normal font-medium text-dim">
        Wir speichern Ihre Adresse und die Größenangabe, um Sie zum Start zu
        benachrichtigen — sonst nichts. Eine formlose Mail genügt, und wir
        löschen den Eintrag wieder.
      </p>
    </form>
  );
}
