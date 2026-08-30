import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, escalations, tenants, tickets } from "@/db/schema";
import type { EscalationRow, TicketRow } from "@/db/schema";
import { buildTicketTag } from "@/lib/subject";
import { answerEscalation } from "@/app/actions/escalations";

export const dynamic = "force-dynamic";

interface EscalationView {
  escalation: EscalationRow;
  ticket: TicketRow | null;
  tenantLabel: string;
}

function loadEscalations(): EscalationView[] {
  const db = getDb();
  const rows = db
    .select()
    .from(escalations)
    .orderBy(desc(escalations.createdAt))
    .all();
  return rows.map((escalation) => {
    const ticket =
      escalation.ticketId != null
        ? (db
            .select()
            .from(tickets)
            .where(eq(tickets.id, escalation.ticketId))
            .get() ?? null)
        : null;

    let tenantLabel = "Unbekannt";
    if (ticket) {
      const tenant = db
        .select()
        .from(tenants)
        .where(eq(tenants.id, ticket.tenantId))
        .get();
      if (tenant) tenantLabel = tenant.name;
    } else {
      const conversation = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, escalation.conversationId))
        .get();
      if (conversation) {
        if (
          conversation.counterpartType === "tenant" &&
          conversation.counterpartId != null
        ) {
          const tenant = db
            .select()
            .from(tenants)
            .where(eq(tenants.id, conversation.counterpartId))
            .get();
          tenantLabel = tenant ? tenant.name : conversation.counterpartEmail;
        } else {
          tenantLabel = conversation.counterpartEmail;
        }
      }
    }
    return { escalation, ticket, tenantLabel };
  });
}

async function submitAnswer(formData: FormData): Promise<void> {
  "use server";
  const escalationId = Number(formData.get("escalationId"));
  const answer = String(formData.get("answer") ?? "");
  await answerEscalation(escalationId, answer);
}

export default function EskalationenPage() {
  const views = loadEscalations();
  const open = views.filter((v) => v.escalation.status === "offen");
  const answered = views.filter((v) => v.escalation.status === "beantwortet");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Eskalationen</h1>
      <p className="mb-6 text-sm text-gray-600">
        Rückfragen der KI an den Vermieter. Ihre Antwort geht als Kontext an die
        KI, die daraus die Antwort an den Mieter formuliert (der Worker muss
        laufen).
      </p>

      <h2 className="mb-3 text-lg font-semibold">
        Offene Rückfragen ({open.length})
      </h2>
      {open.length === 0 && (
        <p className="mb-10 text-gray-500">Keine offenen Rückfragen.</p>
      )}
      <ul className="mb-10 space-y-4">
        {open.map(({ escalation, ticket, tenantLabel }) => (
          <li
            key={escalation.id}
            className="rounded border border-amber-400 bg-amber-50 p-4"
          >
            <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
              <span>Mieter: {tenantLabel}</span>
              {ticket ? (
                <Link
                  className="text-blue-600 underline"
                  href={`/vorgaenge/${ticket.id}`}
                >
                  {buildTicketTag(ticket.id)} {ticket.title}
                </Link>
              ) : (
                <span>Kein Ticket</span>
              )}
            </div>
            <p className="mb-3 font-medium">{escalation.question}</p>
            <form action={submitAnswer} className="space-y-2">
              <input
                type="hidden"
                name="escalationId"
                value={escalation.id}
              />
              <textarea
                name="answer"
                required
                rows={3}
                className="w-full rounded border border-gray-300 bg-white p-2"
                placeholder="Ihre Antwort an die KI …"
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Antwort senden
              </button>
            </form>
            <p className="mt-2 text-xs text-gray-400">
              Erstellt: {escalation.createdAt}
            </p>
          </li>
        ))}
      </ul>

      <h2 className="mb-3 text-lg font-semibold">
        Beantwortet ({answered.length})
      </h2>
      {answered.length === 0 && (
        <p className="text-gray-500">Noch keine beantworteten Rückfragen.</p>
      )}
      <ul className="space-y-4 opacity-60">
        {answered.map(({ escalation, ticket, tenantLabel }) => (
          <li
            key={escalation.id}
            className="rounded border border-gray-200 bg-gray-50 p-4"
          >
            <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
              <span>Mieter: {tenantLabel}</span>
              {ticket ? (
                <Link className="underline" href={`/vorgaenge/${ticket.id}`}>
                  {buildTicketTag(ticket.id)} {ticket.title}
                </Link>
              ) : (
                <span>Kein Ticket</span>
              )}
            </div>
            <p className="font-medium">{escalation.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              Antwort: {escalation.answer}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Beantwortet: {escalation.answeredAt}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
