const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  neu: { label: "Neu", className: "bg-blue-100 text-blue-800" },
  infosammlung: { label: "Infosammlung", className: "bg-cyan-100 text-cyan-800" },
  wartet_auf_genehmigung: {
    label: "Wartet auf Genehmigung",
    className: "bg-amber-100 text-amber-800",
  },
  genehmigt: { label: "Genehmigt", className: "bg-lime-100 text-lime-800" },
  handwerker_angefragt: {
    label: "Handwerker angefragt",
    className: "bg-indigo-100 text-indigo-800",
  },
  terminiert: { label: "Terminiert", className: "bg-purple-100 text-purple-800" },
  erledigt: { label: "Erledigt", className: "bg-green-100 text-green-800" },
  eskaliert: { label: "Eskaliert", className: "bg-red-100 text-red-800" },
  abgelehnt: { label: "Abgelehnt", className: "bg-gray-200 text-gray-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_STYLES[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

export default StatusBadge;
