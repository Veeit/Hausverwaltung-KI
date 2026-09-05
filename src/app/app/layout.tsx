import { count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, escalations } from "@/db/schema";
import type { Metadata } from "next";
import { Nav } from "@/app/components/Nav";

// Ohne eigene Metadaten erbt das Dashboard den Werbetitel der
// Landingpage aus dem Wurzel-Layout.
export const metadata: Metadata = {
  title: "KI-Hausverwaltung",
  description: "Vermieter-Dashboard",
};

/**
 * Layout des Vermieter-Dashboards (alles unter /app).
 *
 * Hier — und nur hier — hängen Navigation, Zählerstände und der helle
 * Werkzeug-Hintergrund. Die öffentliche Landingpage auf / bekommt davon
 * nichts ab.
 */
function openCounts(): { openApprovals: number; openEscalations: number } {
  try {
    const db = getDb();
    const a = db
      .select({ n: count() })
      .from(approvals)
      .where(eq(approvals.status, "offen"))
      .get();
    const e = db
      .select({ n: count() })
      .from(escalations)
      .where(eq(escalations.status, "offen"))
      .get();
    return { openApprovals: a?.n ?? 0, openEscalations: e?.n ?? 0 };
  } catch {
    // Beim statischen Prerender (z.B. /_not-found im Build) kann Env/DB fehlen.
    return { openApprovals: 0, openEscalations: 0 };
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { openApprovals, openEscalations } = openCounts();
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Nav openApprovals={openApprovals} openEscalations={openEscalations} />
      <div className="mx-auto max-w-5xl p-4">{children}</div>
    </div>
  );
}
