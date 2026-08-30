import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, escalations, messages, tickets } from "@/db/schema";
import { TICKET_STATUSES } from "@/lib/tickets";
import { isWorkerPaused } from "@/lib/rateLimit";
import { resumeWorkerAction } from "@/app/actions/worker";
import { StatusBadge } from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  tenant: "Mieter",
  contractor: "Handwerker",
  landlord: "Vermieter",
  ai: "KI-Assistent",
  unknown: "Unbekannt",
};

function excerpt(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function OverviewPage() {
  const db = getDb();
  const paused = isWorkerPaused();

  const statusRows = db
    .select({ status: tickets.status, n: count() })
    .from(tickets)
    .groupBy(tickets.status)
    .all();
  const statusCounts = new Map(statusRows.map((r) => [r.status, r.n]));

  const openApprovals = db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "offen"))
    .orderBy(desc(approvals.id))
    .limit(5)
    .all();

  const openEscalations = db
    .select()
    .from(escalations)
    .where(eq(escalations.status, "offen"))
    .orderBy(desc(escalations.id))
    .limit(5)
    .all();

  const failedMessages = db
    .select()
    .from(messages)
    .where(eq(messages.processingStatus, "failed"))
    .orderBy(desc(messages.id))
    .limit(10)
    .all();

  const unknownMessages = db
    .select()
    .from(messages)
    .where(eq(messages.role, "unknown"))
    .orderBy(desc(messages.id))
    .limit(10)
    .all();

  const recentMessages = db
    .select()
    .from(messages)
    .orderBy(desc(messages.id))
    .limit(10)
    .all();

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Übersicht</h1>

      {paused ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-red-300 bg-red-100 p-4 text-red-900">
          <p className="font-medium">
            Kill-Switch aktiv: Das Mail-Rate-Limit wurde überschritten, der Worker ist
            pausiert. Es werden keine Mails mehr verarbeitet oder versendet.
          </p>
          <form action={resumeWorkerAction}>
            <button
              type="submit"
              className="rounded bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
            >
              Worker fortsetzen
            </button>
          </form>
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-medium">Vorgänge nach Status</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {TICKET_STATUSES.map((status) => (
            <div
              key={status}
              className="rounded border border-gray-200 bg-white p-3 text-center"
            >
              <div className="text-2xl font-semibold">{statusCounts.get(status) ?? 0}</div>
              <StatusBadge status={status} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Offene Genehmigungen</h2>
        {openApprovals.length === 0 ? (
          <p className="text-sm text-gray-500">Keine offenen Genehmigungen.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openApprovals.map((a) => (
              <li key={a.id} className="rounded border border-amber-300 bg-amber-50 p-3">
                <Link href="/genehmigungen" className="font-medium hover:underline">
                  Antrag #{a.id} zu Ticket [HV-{a.ticketId}]
                </Link>
                <p className="text-sm text-gray-700">{a.summary}</p>
                <p className="text-xs text-gray-500">{a.createdAt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Offene Eskalationen</h2>
        {openEscalations.length === 0 ? (
          <p className="text-sm text-gray-500">Keine offenen Eskalationen.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openEscalations.map((e) => (
              <li key={e.id} className="rounded border border-orange-300 bg-orange-50 p-3">
                <Link href="/eskalationen" className="font-medium hover:underline">
                  Rückfrage #{e.id}
                  {e.ticketId !== null ? ` zu Ticket [HV-${e.ticketId}]` : ""}
                </Link>
                <p className="text-sm text-gray-700">{e.question}</p>
                <p className="text-xs text-gray-500">{e.createdAt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Fehlgeschlagene Verarbeitung</h2>
        {failedMessages.length === 0 ? (
          <p className="text-sm text-gray-500">Keine fehlgeschlagenen Nachrichten.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failedMessages.map((m) => (
              <li key={m.id} className="rounded border border-red-200 bg-white p-3">
                <p className="text-sm font-medium">
                  Nachricht #{m.id} von {m.fromEmail} — {m.subject || "(kein Betreff)"}
                </p>
                <p className="text-xs text-red-700">
                  {m.processingError ?? "Unbekannter Fehler"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Unzugeordnete Absender</h2>
        {unknownMessages.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Nachrichten unbekannter Absender.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {unknownMessages.map((m) => (
              <li key={m.id} className="rounded border border-gray-200 bg-white p-3">
                <p className="text-sm font-medium">
                  {m.fromEmail} — {m.subject || "(kein Betreff)"}{" "}
                  <span className="text-xs font-normal text-gray-500">{m.createdAt}</span>
                </p>
                <p className="text-sm text-gray-700">{excerpt(m.body)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Letzte Nachrichten</h2>
        {recentMessages.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Nachrichten.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentMessages.map((m) => (
              <li key={m.id} className="rounded border border-gray-200 bg-white p-3">
                <p className="text-xs text-gray-500">
                  {m.direction === "inbound" ? "Eingang" : "Ausgang"} ·{" "}
                  {ROLE_LABELS[m.role] ?? m.role} · {m.fromEmail} → {m.toEmail} ·{" "}
                  {m.createdAt}
                </p>
                <p className="text-sm font-medium">{m.subject || "(kein Betreff)"}</p>
                <p className="text-sm text-gray-700">{excerpt(m.body)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
