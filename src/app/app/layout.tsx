import type { Metadata } from "next";
import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, escalations, messages, properties, tenants } from "@/db/schema";
import { isWorkerPaused } from "@/lib/rateLimit";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/app/components/AppShell";

export const metadata: Metadata = {
  title: "Hausverwaltung",
  description: "KI-gestützte Hausverwaltung (Proof of Concept)",
};

interface ShellData {
  openTasks: number;
  objectName: string;
  objectSub: string;
  lastPollLabel: string;
}

const FALLBACK: ShellData = {
  openTasks: 0,
  objectName: "Hausverwaltung",
  objectSub: "",
  lastPollLabel: "Zustand nicht abrufbar",
};

/**
 * Kopfdaten für den Rahmen. Der Name in der Seitenleiste ist die Adresse des
 * Objekts, sobald es genau eines gibt — ein privater Vermieter erkennt sein
 * Haus daran schneller als am Produktnamen.
 */
function shellData(): ShellData {
  try {
    const db = getDb();
    const openApprovals =
      db.select({ n: count() }).from(approvals).where(eq(approvals.status, "offen")).get()?.n ?? 0;
    const openEscalations =
      db.select({ n: count() }).from(escalations).where(eq(escalations.status, "offen")).get()?.n ?? 0;

    const allProperties = db.select().from(properties).all();
    const tenantCount = db.select({ n: count() }).from(tenants).get()?.n ?? 0;

    const objectName =
      allProperties.length === 1 ? allProperties[0].address : "Hausverwaltung";
    const objectSub =
      allProperties.length === 1
        ? `${tenantCount} Mieter`
        : `${allProperties.length} Objekte · ${tenantCount} Mieter`;

    const lastMessage = db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .orderBy(desc(messages.id))
      .limit(1)
      .get();

    const lastPollLabel = isWorkerPaused()
      ? "Pausiert — es werden keine Mails verarbeitet."
      : lastMessage
        ? `Letzte Nachricht: ${formatDate(lastMessage.createdAt)}`
        : "Noch keine Nachricht eingegangen.";

    return { openTasks: openApprovals + openEscalations, objectName, objectSub, lastPollLabel };
  } catch {
    // Beim statischen Prerender (z.B. /_not-found im Build) fehlen Env und DB.
    return FALLBACK;
  }
}

/**
 * Rahmen des Vermieter-Dashboards (alles unter /app).
 *
 * Lag früher im Wurzel-Layout. Seit die Produktseite auf / sitzt, gehört er
 * hierher — sonst erschiene die Seitenleiste auch über der Werbefläche.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const data = shellData();
  return <AppShell {...data}>{children}</AppShell>;
}
