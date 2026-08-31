// Gemeinsame Formatierungs-Helfer für das Dashboard. Vorher gab es
// formatDate() vierfach kopiert (Vorgänge, Vorgang-Detail, Genehmigungen —
// Übersicht und Eskalationen zeigten stattdessen rohe UTC-Zeitstempel ganz
// ohne Formatierung) und ROLE_LABELS dreifach kopiert (Übersicht,
// Vorgang-Detail, agent/context.ts). Beides liegt jetzt an einer Stelle.

export const ROLE_LABELS: Record<string, string> = {
  tenant: "Mieter",
  contractor: "Handwerker",
  landlord: "Vermieter",
  ai: "KI-Assistent",
  unknown: "Unbekannt",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Unbekannt";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
}
