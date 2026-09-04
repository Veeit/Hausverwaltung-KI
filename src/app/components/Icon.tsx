/**
 * Strich-Icons auf 24er-Raster, gerade Enden und Ecken — passend zur
 * Helvetica-Neue-Typografie. Bewusst als Inline-SVG und nicht als Icon-Paket:
 * es sind zwei Dutzend Glyphen, sie sollen `currentColor` erben, und ein
 * Emoji- oder Dingbat-Ersatz kommt nicht in Frage.
 *
 * PATHS ist eine modul-lokale Konstante ohne jeden Fremdeingang — deshalb ist
 * dangerouslySetInnerHTML hier unbedenklich; es steht nie ein Wert darin, der
 * aus Datenbank, Mail oder Formular stammt.
 */

const PATHS = {
  uebersicht:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  erledigen: '<path d="M20.4 11.3V12a8.4 8.4 0 1 1-4.9-7.7"/><path d="M9 11.4l3 3 8.4-8.4"/>',
  vorgaenge:
    '<path d="M6.5 3.5h8l4 4.2v12.3a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-15a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.2 3.8v4.1h4.1"/><path d="M8.5 13h7M8.5 16.8h4.5"/>',
  frage:
    '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3 2.4c-.6.2-.9.7-.9 1.3v.6"/><path d="M11.9 17.1h.2"/>',
  stammdaten:
    '<circle cx="9.5" cy="8.4" r="3.4"/><path d="M3.6 19.6c0-3.2 2.6-5.4 5.9-5.4s5.9 2.2 5.9 5.4"/><path d="M16.6 6.3a3.3 3.3 0 0 1 0 6.2M18.2 19.6c0-2-.7-3.6-1.9-4.7"/>',
  dokumente:
    '<path d="M4.5 6.5a2 2 0 0 1 2-2h3.4l2 2.6h5.6a2 2 0 0 1 2 2v9.4a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/>',
  mail:
    '<rect x="3" y="5.2" width="18" height="13.6" rx="1.5"/><path d="M3.9 6.8l7.2 5.4a1.5 1.5 0 0 0 1.8 0l7.2-5.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3 1.8"/>',
  zurueck: '<path d="M19.5 12H5"/><path d="M11 5.5L4.5 12l6.5 6.5"/>',
  weiter: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  runter: '<path d="M5.5 9.5l6.5 6.5 6.5-6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload:
    '<path d="M12 16.2V4.6"/><path d="M7.6 9L12 4.6 16.4 9"/><path d="M4.6 15.4v3.2a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3.2"/>',
  loeschen:
    '<path d="M4.6 6.6h14.8"/><path d="M9.6 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.6 6.6l.9 12.9a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.9"/>',
  abmelden:
    '<path d="M15 8.2V6.3a2 2 0 0 0-2-2H6.2a2 2 0 0 0-2 2v11.4a2 2 0 0 0 2 2H13a2 2 0 0 0 2-2v-1.9"/><path d="M20 12H9.6"/><path d="M16.6 8.6L20 12l-3.4 3.4"/>',
  mehr: '<circle cx="5.2" cy="12" r="1.35"/><circle cx="12" cy="12" r="1.35"/><circle cx="18.8" cy="12" r="1.35"/>',
  anhang:
    '<path d="M18.2 11.6l-7.1 7.1a4 4 0 0 1-5.7-5.7l7.9-7.9a2.8 2.8 0 0 1 4 4l-7.9 7.9a1.6 1.6 0 0 1-2.3-2.3l7.2-7.2"/>',
  check: '<path d="M5 12.6l4.6 4.6L19 6.8"/>',
  x: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8"/>',
  haus: '<path d="M4 10.4L12 4l8 6.4v8.6a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M9.6 20.5v-6.2h4.8v6.2"/>',
  schloss: '<rect x="4.6" y="10.2" width="14.8" height="10.2" rx="1.5"/><path d="M8 10.2V7.6a4 4 0 0 1 8 0v2.6"/>',
  gebaeude:
    '<path d="M5 20.5V5.4a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v15.1"/><path d="M15 10.4h3a1.5 1.5 0 0 1 1.5 1.5v8.6"/><path d="M3.5 20.5h17"/><path d="M8 8h4M8 12h4M8 16h4"/>',
  werkzeug:
    '<path d="M14.2 6.6a3.9 3.9 0 0 1 5.2 4.9l-8.4 8.4a2.3 2.3 0 0 1-3.3-3.3l8.4-8.4"/><path d="M9.4 5.4L5.6 9.2 3.5 7.1 7.3 3.3z"/>',
  senden: '<path d="M20.5 3.5L10.6 13.4"/><path d="M20.5 3.5l-6.4 17-3.5-7.1-7.1-3.5z"/>',
  ki:
    '<rect x="4" y="7.6" width="16" height="11.8" rx="2"/><path d="M12 3.4v4.2"/><circle cx="9.2" cy="13.2" r="1.15"/><circle cx="14.8" cy="13.2" r="1.15"/><path d="M9.8 16.5h4.4"/>',
  warnung: '<path d="M12 3.6l9.2 15.9H2.8z"/><path d="M12 9.6v4.3M11.9 16.7h.2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "icon",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export default Icon;
