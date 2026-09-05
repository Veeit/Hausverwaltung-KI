import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropPilot — KI-gestützte Hausverwaltung per E-Mail",
  description:
    "Ihr Mieter schreibt um 23:41. Um 23:42 weiß der Handwerker Bescheid. " +
    "Eine KI führt den Dialog, Sie geben per Klick frei.",
};

/**
 * Wurzel-Layout: nur Dokumentgerüst und Stylesheet.
 *
 * Der Rahmen des Dashboards (Seitenleiste, Kopfdaten) sitzt bewusst NICHT
 * hier, sondern in src/app/app/layout.tsx — sonst läge er auch über der
 * öffentlichen Produktseite und der Anmeldeseite.
 *
 * Die Schriften der Produktseite werden hier geladen, weil <head> nur im
 * Wurzel-Layout liegt; das Dashboard nutzt sie nicht und zahlt dafür nur den
 * Stylesheet-Verweis.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;800;900&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
