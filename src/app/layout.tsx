import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "KI-Hausverwaltung",
  description: "KI-gestützte Hausverwaltung per E-Mail — Proof of Concept",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
