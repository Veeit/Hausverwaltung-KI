/**
 * Die neun Ticketstatus in der Sprache des Vermieters statt in der des
 * Systems ("infosammlung", "eskaliert"). className ist die Farbklasse aus
 * globals.css: farbig sind nur die Zustände, die etwas bedeuten — was Sie
 * entscheiden müssen (Zinnober) und was fertig ist (Grün). Der Rest ist grau.
 */
export const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  neu: { label: "Neu", className: "s-neu" },
  infosammlung: { label: "Assistent klärt Details", className: "s-info" },
  wartet_auf_genehmigung: { label: "Wartet auf Ihre Freigabe", className: "s-wait" },
  genehmigt: { label: "Freigegeben", className: "s-appr" },
  handwerker_angefragt: { label: "Handwerker angefragt", className: "s-req" },
  terminiert: { label: "Termin steht", className: "s-term" },
  erledigt: { label: "Erledigt", className: "s-done" },
  eskaliert: { label: "Rückfrage offen", className: "s-esc" },
  abgelehnt: { label: "Abgelehnt", className: "s-rej" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_STYLES[status] ?? { label: status, className: "s-neu" };
  return <span className={`badge ${entry.className}`}>{entry.label}</span>;
}

/** Dringlichkeit aus dem Ticket; `null` heißt "noch nicht eingeschätzt". */
export function UrgencyTag({ urgency }: { urgency: string | null }) {
  if (!urgency) return null;
  const known = ["niedrig", "mittel", "hoch", "notfall"].includes(urgency);
  const label = urgency === "notfall" ? "Notfall" : urgency === "hoch" ? "Dringend" : urgency;
  return (
    <span className={`urg ${known ? `u-${urgency}` : "u-niedrig"}`}>{label}</span>
  );
}

export default StatusBadge;
