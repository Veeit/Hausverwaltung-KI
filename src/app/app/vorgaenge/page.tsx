import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, tickets } from "@/db/schema";
import { buildTicketTag } from "@/lib/subject";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

export default function VorgaengePage() {
  const db = getDb();
  const rows = db
    .select({ ticket: tickets, tenantName: tenants.name })
    .from(tickets)
    .innerJoin(tenants, eq(tickets.tenantId, tenants.id))
    .orderBy(desc(tickets.updatedAt))
    .all();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Vorgänge</h1>
      {rows.length === 0 ? (
        <p className="text-gray-500">Noch keine Vorgänge vorhanden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 font-semibold">Tag</th>
                <th className="px-3 py-2 font-semibold">Titel</th>
                <th className="px-3 py-2 font-semibold">Mieter</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Dringlichkeit</th>
                <th className="px-3 py-2 font-semibold">Aktualisiert</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ticket, tenantName }) => (
                <tr key={ticket.id} className="border-t border-gray-200 align-top">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {buildTicketTag(ticket.id)}
                  </td>
                  <td className="px-3 py-2">{ticket.title}</td>
                  <td className="px-3 py-2">{tenantName}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-3 py-2">{ticket.urgency ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(ticket.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/vorgaenge/${ticket.id}`}
                      className="text-blue-600 underline"
                    >
                      Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
