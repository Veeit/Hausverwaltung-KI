import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  approvals,
  attachments,
  contractors,
  escalations,
  messages,
  properties,
  tenants,
  tickets,
  type AttachmentRow,
} from "@/db/schema";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/tickets";
import { buildTicketTag } from "@/lib/subject";
import { sendManualReply, setTicketStatus } from "@/app/actions/tickets";
import StatusBadge from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  tenant: "Mieter",
  contractor: "Handwerker",
  landlord: "Vermieter",
  ai: "KI-Assistent",
  unknown: "Unbekannt",
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: "eingehend",
  outbound: "ausgehend",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
}

async function changeStatusAction(formData: FormData): Promise<void> {
  "use server";
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("status") ?? "");
  if (!(TICKET_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`Unbekannter Status: ${raw}`);
  }
  await setTicketStatus(ticketId, raw as TicketStatus);
}

async function manualReplyAction(formData: FormData): Promise<void> {
  "use server";
  const ticketId = Number(formData.get("ticketId"));
  const text = String(formData.get("text") ?? "");
  await sendManualReply(ticketId, text);
}

export default async function VorgangDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();

  const db = getDb();
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) notFound();

  const tenant = db.select().from(tenants).where(eq(tenants.id, ticket.tenantId)).get();
  const property = tenant
    ? db.select().from(properties).where(eq(properties.id, tenant.propertyId)).get()
    : undefined;
  const contractor = ticket.contractorId
    ? db.select().from(contractors).where(eq(contractors.id, ticket.contractorId)).get()
    : undefined;

  // Der Verlauf umfasst BEIDE Conversations: die des Mieters (über
  // conversationId) und die des Handwerkers (dessen Nachrichten tragen zwar
  // dieses ticketId, liegen aber in einer eigenen Conversation). Ohne das
  // or(...) fehlte der komplette Handwerker-Teil — also genau der Abschnitt,
  // den Spec §7 ausdrücklich als "Mieter ↔ KI ↔ Handwerker" verlangt.
  const messageRows = db
    .select()
    .from(messages)
    .where(
      or(
        eq(messages.conversationId, ticket.conversationId),
        eq(messages.ticketId, ticket.id),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .all();

  const messageIds = messageRows.map((m) => m.id);
  const attachmentRows =
    messageIds.length > 0
      ? db
          .select()
          .from(attachments)
          .where(inArray(attachments.messageId, messageIds))
          .all()
      : [];
  const attachmentsByMessage = new Map<number, AttachmentRow[]>();
  for (const a of attachmentRows) {
    const list = attachmentsByMessage.get(a.messageId) ?? [];
    list.push(a);
    attachmentsByMessage.set(a.messageId, list);
  }

  const approvalRows = db
    .select({ approval: approvals, contractorName: contractors.name })
    .from(approvals)
    .innerJoin(contractors, eq(approvals.contractorId, contractors.id))
    .where(eq(approvals.ticketId, ticket.id))
    .orderBy(asc(approvals.id))
    .all();

  const escalationRows = db
    .select()
    .from(escalations)
    .where(eq(escalations.ticketId, ticket.id))
    .orderBy(asc(escalations.id))
    .all();

  let collectedInfo: Record<string, string> = {};
  try {
    collectedInfo = JSON.parse(ticket.collectedInfo) as Record<string, string>;
  } catch {
    collectedInfo = {};
  }
  const infoEntries = Object.entries(collectedInfo);

  return (
    <main className="p-6 space-y-8 max-w-4xl">
      <header>
        <p className="text-sm text-gray-500">
          <Link href="/vorgaenge" className="underline">
            ← Zur Vorgangsliste
          </Link>
        </p>
        <h1 className="text-2xl font-bold mt-2">
          <span className="font-mono">{buildTicketTag(ticket.id)}</span> {ticket.title}{" "}
          <StatusBadge status={ticket.status} />
        </h1>
      </header>

      <section className="border border-gray-200 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Ticket-Daten</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
          <dt className="font-medium">Typ</dt>
          <dd>{ticket.type}</dd>
          <dt className="font-medium">Dringlichkeit</dt>
          <dd>{ticket.urgency ?? "—"}</dd>
          <dt className="font-medium">Zusammenfassung</dt>
          <dd>{ticket.summary ?? "—"}</dd>
          <dt className="font-medium">Mieter</dt>
          <dd>
            {tenant ? `${tenant.name} (${tenant.email})` : "Unbekannt"}
            {tenant?.unitLabel ? `, Wohnung: ${tenant.unitLabel}` : ""}
          </dd>
          <dt className="font-medium">Objekt</dt>
          <dd>{property?.address ?? "—"}</dd>
          <dt className="font-medium">Handwerker</dt>
          <dd>
            {contractor
              ? `${contractor.name} (${contractor.trade}, ${contractor.email})`
              : "—"}
          </dd>
          <dt className="font-medium">Termin</dt>
          <dd>{ticket.appointmentAt ?? "—"}</dd>
          <dt className="font-medium">Angelegt</dt>
          <dd>{formatDate(ticket.createdAt)}</dd>
          <dt className="font-medium">Aktualisiert</dt>
          <dd>{formatDate(ticket.updatedAt)}</dd>
        </dl>

        <h3 className="text-sm font-semibold mt-4 mb-1">Gesammelte Informationen</h3>
        {infoEntries.length === 0 ? (
          <p className="text-sm text-gray-500">Keine gesammelten Informationen.</p>
        ) : (
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
            {infoEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-medium">{key}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="border border-gray-200 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Manuelle Aktionen</h2>
        <form action={changeStatusAction} className="flex items-center gap-2 mb-4">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <label htmlFor="status" className="text-sm font-medium">
            Status setzen:
          </label>
          <select
            id="status"
            name="status"
            defaultValue={ticket.status}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-gray-800 text-white rounded px-3 py-1 text-sm"
          >
            Übernehmen
          </button>
        </form>

        <form action={manualReplyAction} className="space-y-2">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <label htmlFor="text" className="block text-sm font-medium">
            Selbst als Vermieter antworten (E-Mail an den Mieter):
          </label>
          <textarea
            id="text"
            name="text"
            required
            rows={5}
            placeholder="Ihre Antwort an den Mieter…"
            className="w-full border border-gray-300 rounded p-2 text-sm"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-3 py-1 text-sm"
          >
            Antwort senden
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Nachrichtenverlauf</h2>
        {messageRows.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Nachrichten.</p>
        ) : (
          <ol className="space-y-4">
            {messageRows.map((m) => (
              <li key={m.id} className="border border-gray-200 rounded p-3 text-sm">
                <p className="font-semibold">
                  {ROLE_LABELS[m.role] ?? m.role} ({DIRECTION_LABELS[m.direction] ?? m.direction})
                  <span className="font-normal text-gray-500">
                    {" "}
                    — {formatDate(m.createdAt)}
                  </span>
                </p>
                <p className="text-gray-500">
                  Von {m.fromEmail} an {m.toEmail}
                  {m.subject ? ` — Betreff: ${m.subject}` : ""}
                </p>
                <p className="whitespace-pre-wrap mt-2">{m.body}</p>
                {(attachmentsByMessage.get(m.id) ?? []).length > 0 && (
                  <p className="mt-2 text-gray-600">
                    Anhänge:{" "}
                    {(attachmentsByMessage.get(m.id) ?? [])
                      .map((a) => a.filename)
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Genehmigungsanträge</h2>
        {approvalRows.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Genehmigungsanträge.</p>
        ) : (
          <ul className="space-y-3">
            {approvalRows.map(({ approval, contractorName }) => (
              <li key={approval.id} className="border border-gray-200 rounded p-3 text-sm">
                <p>
                  <span className="font-semibold">Status:</span> {approval.status}
                  {approval.decidedAt ? ` (entschieden am ${formatDate(approval.decidedAt)})` : ""}
                </p>
                <p>
                  <span className="font-semibold">Handwerker:</span> {contractorName}
                </p>
                <p className="whitespace-pre-wrap mt-1">{approval.summary}</p>
                {approval.decisionNote && (
                  <p className="mt-1">
                    <span className="font-semibold">Begründung:</span> {approval.decisionNote}
                  </p>
                )}
                {approval.status === "offen" && (
                  <p className="mt-1">
                    <Link href="/genehmigungen" className="text-blue-600 underline">
                      Zur Genehmigungsseite
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Eskalationen</h2>
        {escalationRows.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Eskalationen.</p>
        ) : (
          <ul className="space-y-3">
            {escalationRows.map((e) => (
              <li key={e.id} className="border border-gray-200 rounded p-3 text-sm">
                <p>
                  <span className="font-semibold">Status:</span> {e.status}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Frage der KI:</span>{" "}
                  <span className="whitespace-pre-wrap">{e.question}</span>
                </p>
                {e.answer && (
                  <p className="mt-1">
                    <span className="font-semibold">Antwort des Vermieters:</span>{" "}
                    <span className="whitespace-pre-wrap">{e.answer}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
