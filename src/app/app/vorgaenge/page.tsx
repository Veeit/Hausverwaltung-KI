import Link from "next/link";
import { desc, eq, inArray, not } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, tickets } from "@/db/schema";
import { buildTicketTag } from "@/lib/subject";
import { formatDate } from "@/lib/format";
import { Icon } from "@/app/components/Icon";
import { StatusBadge, UrgencyTag } from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

/**
 * Zwei Gruppen statt neun Statusspalten: Was läuft, und was durch ist. Bei
 * einer Handvoll Anfragen im Jahr trägt eine Tabelle mit Filtern und Suche
 * nichts bei — die Liste ist kürzer als jede Filterleiste.
 */
const CLOSED_STATUSES = ["erledigt", "abgelehnt"] as const;

export default function VorgaengePage() {
  const db = getDb();

  const select = () =>
    db
      .select({ ticket: tickets, tenantName: tenants.name, unitLabel: tenants.unitLabel })
      .from(tickets)
      .innerJoin(tenants, eq(tickets.tenantId, tenants.id));

  const open = select()
    .where(not(inArray(tickets.status, [...CLOSED_STATUSES])))
    .orderBy(desc(tickets.updatedAt))
    .all();

  const closed = select()
    .where(inArray(tickets.status, [...CLOSED_STATUSES]))
    .orderBy(desc(tickets.updatedAt))
    .all();

  const total = open.length + closed.length;

  const row = (
    {
      ticket,
      tenantName,
      unitLabel,
    }: {
      ticket: typeof tickets.$inferSelect;
      tenantName: string;
      unitLabel: string | null;
    },
    showUrgency = true,
  ) => (
    <li key={ticket.id}>
      <span className="tag">{buildTicketTag(ticket.id)}</span>
      <div className="grow">
        <p style={{ fontWeight: 700 }}>
          <Link href={`/app/vorgaenge/${ticket.id}`}>{ticket.title}</Link>
        </p>
        <p className="meta">
          {tenantName}
          {unitLabel ? ` · ${unitLabel}` : ""}
        </p>
      </div>
      {showUrgency ? <UrgencyTag urgency={ticket.urgency} /> : null}
      <StatusBadge status={ticket.status} />
      <span className="meta hide-s" style={{ whiteSpace: "nowrap", width: 118, textAlign: "right" }}>
        {formatDate(ticket.updatedAt)}
      </span>
      <Link href={`/app/vorgaenge/${ticket.id}`} aria-label={`Vorgang ${buildTicketTag(ticket.id)} öffnen`}>
        <Icon name="weiter" className="icon icon-sm" />
      </Link>
    </li>
  );

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Vorgänge</h1>
          <p className="meta">
            {total === 0
              ? "Noch kein Vorgang"
              : `${total} ${total === 1 ? "Anfrage" : "Anfragen"} insgesamt · ${open.length} davon offen`}
          </p>
        </div>
      </header>

      <main className="main main-narrow">
        {total === 0 ? (
          <section className="card">
            <div className="empty">
              <span className="empty-mark">
                <Icon name="vorgaenge" />
              </span>
              <h2 style={{ fontSize: "22px" }}>Noch keine Vorgänge.</h2>
              <p className="lead" style={{ maxWidth: "48ch" }}>
                Sobald ein Mieter an Ihre Hausverwaltungs-Adresse schreibt, legt der
                Assistent hier einen Vorgang an.
              </p>
            </div>
          </section>
        ) : null}

        {open.length > 0 ? (
          <section className="card">
            <div className="card-h">
              <h2>Läuft gerade</h2>
              <span className="meta push">{open.length}</span>
            </div>
            <ul className="rows">{open.map((r) => row(r))}</ul>
          </section>
        ) : total > 0 ? (
          <div className="note note-ok note-c">
            <Icon name="check" />
            <p>Kein laufender Vorgang — alles abgeschlossen.</p>
          </div>
        ) : null}

        {closed.length > 0 ? (
          <section className="card">
            <div className="card-h">
              <h2>Erledigt</h2>
              <span className="meta push">{closed.length}</span>
            </div>
            <ul className="rows">{closed.map((r) => row(r, false))}</ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
