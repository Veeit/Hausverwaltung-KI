import { describe, expect, it } from "vitest";
import { STATUS_STYLES } from "@/app/components/StatusBadge";
import { TICKET_STATUSES } from "@/lib/tickets";

// Server Component ohne Render-Bibliothek geprüft: STATUS_STYLES ist die
// exportierte Zuordnung, die StatusBadge auch beim tatsächlichen Rendern
// verwendet. Ein zehnter Status ohne Eintrag hier würde im echten Rendering
// still auf den grauen Fallback (Label = Rohwert) zurückfallen — das soll
// dieser Test verhindern.
describe("StatusBadge – STATUS_STYLES deckt alle TICKET_STATUSES ab", () => {
  it.each(TICKET_STATUSES)(
    "Status '%s' hat einen eigenen Eintrag mit nicht-generischem deutschen Label",
    (status) => {
      const entry = STATUS_STYLES[status];
      expect(entry, `Status '${status}' fehlt in STATUS_STYLES`).toBeDefined();
      // Kein Rückfall auf den Rohwert (das wäre der graue Fallback-Fall)
      expect(entry.label).not.toBe(status);
      expect(entry.label.trim().length).toBeGreaterThan(0);
    },
  );

  it("vergibt für jeden Status ein eindeutiges Label (keine Kollisionen)", () => {
    const labels = TICKET_STATUSES.map((status) => STATUS_STYLES[status]?.label);
    expect(new Set(labels).size).toBe(TICKET_STATUSES.length);
  });

  it("STATUS_STYLES enthält keine Status außerhalb von TICKET_STATUSES (verwaiste Einträge)", () => {
    const known = new Set<string>(TICKET_STATUSES);
    for (const key of Object.keys(STATUS_STYLES)) {
      expect(known.has(key), `'${key}' ist kein bekannter TicketStatus mehr`).toBe(true);
    }
  });
});
