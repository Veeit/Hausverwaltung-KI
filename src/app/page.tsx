import Link from "next/link";
import { and, count, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  approvals,
  contractors,
  conversations,
  escalations,
  messages,
  properties,
  tenants,
  tickets,
} from "@/db/schema";
import { isWorkerPaused } from "@/lib/rateLimit";
import { listDocuments } from "@/lib/documents";
import { buildTicketTag } from "@/lib/subject";
import { formatDate } from "@/lib/format";
import { resumeWorkerAction, reprocessMessage } from "@/app/actions/worker";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";
import { StatusBadge, UrgencyTag } from "@/app/components/StatusBadge";
import { Steps } from "@/app/components/Steps";

export const dynamic = "force-dynamic";

// Ab wann eine 'processing'-Nachricht als hängen geblieben gilt. Normale
// Agent-Läufe dauern Sekunden bis wenige Minuten; der Worker setzt hängen
// gebliebene Nachrichten beim Neustart automatisch zurück (siehe
// resetStuckProcessingMessages), aber solange kein Neustart erfolgt ist (der
// Prozess also z.B. hängt statt abzustürzen), soll das hier sichtbar werden.
const STUCK_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;

function excerpt(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function today(): string {
  return new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  });
}

interface Task {
  kind: "approval" | "escalation";
  key: string;
  ticketId: number | null;
  title: string;
  text: string;
  who: string;
  urgency: string | null;
  createdAt: string;
}

export default function OverviewPage() {
  const db = getDb();
  const paused = isWorkerPaused();
  const alias = process.env.MAIL_ALIAS ?? "";

  const approvalRows = db
    .select({
      approval: approvals,
      ticket: tickets,
      tenantName: tenants.name,
      unitLabel: tenants.unitLabel,
      contractorName: contractors.name,
    })
    .from(approvals)
    .innerJoin(tickets, eq(approvals.ticketId, tickets.id))
    .innerJoin(tenants, eq(tickets.tenantId, tenants.id))
    .innerJoin(contractors, eq(approvals.contractorId, contractors.id))
    .where(eq(approvals.status, "offen"))
    .all();

  const escalationRows = db
    .select({
      escalation: escalations,
      ticket: tickets,
      tenantName: tenants.name,
      unitLabel: tenants.unitLabel,
      counterpartEmail: conversations.counterpartEmail,
    })
    .from(escalations)
    .leftJoin(tickets, eq(escalations.ticketId, tickets.id))
    .leftJoin(tenants, eq(tickets.tenantId, tenants.id))
    .leftJoin(conversations, eq(escalations.conversationId, conversations.id))
    .where(eq(escalations.status, "offen"))
    .all();

  const who = (name: string | null, unit: string | null, fallback: string | null) => {
    const parts = [name ?? fallback ?? "Unbekannt"];
    if (unit) parts.push(unit);
    return parts.join(" · ");
  };

  const tasks: Task[] = [
    ...approvalRows.map((r) => ({
      kind: "approval" as const,
      key: `a-${r.approval.id}`,
      ticketId: r.ticket.id,
      title: r.ticket.title,
      text: `${r.approval.summary} — vorgeschlagen: ${r.contractorName}.`,
      who: who(r.tenantName, r.unitLabel, null),
      urgency: r.ticket.urgency,
      createdAt: r.approval.createdAt,
    })),
    ...escalationRows.map((r) => ({
      kind: "escalation" as const,
      key: `e-${r.escalation.id}`,
      ticketId: r.ticket?.id ?? null,
      title: r.ticket?.title ?? "Rückfrage ohne Vorgang",
      text: r.escalation.question,
      who: who(r.tenantName, r.unitLabel, r.counterpartEmail),
      urgency: r.ticket?.urgency ?? null,
      createdAt: r.escalation.createdAt,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Systemzustand: erscheint nur, wenn etwas nicht stimmt.
  const failedMessages = db
    .select()
    .from(messages)
    .where(eq(messages.processingStatus, "failed"))
    .orderBy(desc(messages.id))
    .limit(10)
    .all();

  const stuckCutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS).toISOString();
  const stuckMessages = db
    .select()
    .from(messages)
    .where(and(eq(messages.processingStatus, "processing"), lt(messages.createdAt, stuckCutoff)))
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
  // Bekannte Adressen vorab laden, um pro unbekannter Nachricht zu
  // entscheiden, ob "Erneut freigeben" angezeigt wird — reprocessMessage()
  // lehnt sonst mit einem Fehler ab, wenn der Absender weiterhin unbekannt ist.
  const knownEmails = new Set([
    ...db.select({ email: tenants.email }).from(tenants).all().map((t) => t.email),
    ...db.select({ email: contractors.email }).from(contractors).all().map((c) => c.email),
  ]);

  const hasSystemIssue =
    failedMessages.length > 0 || stuckMessages.length > 0 || unknownMessages.length > 0;

  const recentlyClosed = db
    .select({ ticket: tickets, tenantName: tenants.name })
    .from(tickets)
    .innerJoin(tenants, eq(tickets.tenantId, tenants.id))
    .where(eq(tickets.status, "erledigt"))
    .orderBy(desc(tickets.updatedAt))
    .limit(3)
    .all();

  const tenantCount = db.select({ n: count() }).from(tenants).get()?.n ?? 0;
  const contractorCount = db.select({ n: count() }).from(contractors).get()?.n ?? 0;
  const propertyCount = db.select({ n: count() }).from(properties).get()?.n ?? 0;
  const documentCount = listDocuments().length;
  const setupComplete = tenantCount > 0 && contractorCount > 0 && propertyCount > 0;

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Übersicht</h1>
          <p className="meta">{today()}</p>
        </div>
      </header>

      <main className="main main-mid">
        {paused ? (
          <div className="note note-danger note-c">
            <Icon name="warnung" />
            <div className="grow">
              <p style={{ fontWeight: 700 }}>
                Not-Aus aktiv: Es wurden ungewöhnlich viele Mails verschickt, der
                Assistent ist pausiert.
              </p>
              <p style={{ fontSize: "13.5px", opacity: 0.9 }}>
                Es werden keine Mails mehr gelesen oder versendet, bis Sie fortsetzen.
              </p>
            </div>
            <form action={resumeWorkerAction}>
              <button type="submit" className="btn btn-sm btn-ghost">
                Assistent fortsetzen
              </button>
            </form>
          </div>
        ) : null}

        {tasks.length === 0 ? (
          <>
            <section className="card">
              <div className="empty">
                <span className="empty-mark">
                  <Icon name="check" />
                </span>
                <h2 style={{ fontSize: "25px" }}>Alles ruhig.</h2>
                <p className="lead" style={{ maxWidth: "52ch" }}>
                  Es liegt nichts an. Schreibt ein Mieter, klärt der Assistent die
                  Details selbst — und meldet sich hier erst, wenn er eine
                  Entscheidung von Ihnen braucht.
                </p>
                {recentlyClosed.length > 0 ? (
                  <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <span className="tag">{buildTicketTag(recentlyClosed[0].ticket.id)}</span>
                    <span className="meta">
                      Zuletzt erledigt: „{recentlyClosed[0].ticket.title}“ ·{" "}
                      {formatDate(recentlyClosed[0].ticket.updatedAt)}
                    </span>
                  </div>
                ) : (
                  <p className="meta">Noch kein Vorgang — es hat sich bisher niemand gemeldet.</p>
                )}
              </div>
            </section>

            <div className="grid-2">
              <section className="card">
                <div className="card-h">
                  <h2>Die Adresse für Ihre Mieter</h2>
                </div>
                <div className="card-b" style={{ gap: 13 }}>
                  <p className="muted">
                    Diese Adresse geben Sie Ihren Mietern — am besten im Hausflur und
                    im Mietvertrag.
                  </p>
                  {alias ? (
                    <div
                      className="field row"
                      style={{ height: 52, background: "var(--surface-2)" }}
                    >
                      <span className="mail" style={{ fontSize: 15 }}>
                        {alias}
                      </span>
                    </div>
                  ) : (
                    <p className="meta">
                      Noch keine Adresse konfiguriert (MAIL_ALIAS in der
                      Server-Konfiguration).
                    </p>
                  )}
                  <p className="meta">
                    Nur Post an genau diese Adresse wird verarbeitet. Ihre übrige Post
                    im selben Postfach bleibt unangetastet.
                  </p>
                </div>
              </section>

              <section className="card">
                <div className="card-h">
                  <h2>Wenn etwas passiert</h2>
                </div>
                <div className="card-b" style={{ gap: 16 }}>
                  <Steps compact />
                </div>
              </section>
            </div>
          </>
        ) : (
          <section className="stack-sm">
            <div className="row-wrap">
              <h2>
                {tasks.length === 1
                  ? "Eine Entscheidung wartet auf Sie"
                  : `${tasks.length} Entscheidungen warten auf Sie`}
              </h2>
              {tasks.length > 3 ? (
                <Link
                  href="/zu-erledigen"
                  className="push"
                  style={{ fontSize: "13.5px", whiteSpace: "nowrap" }}
                >
                  Alle {tasks.length} ansehen
                </Link>
              ) : null}
            </div>

            {tasks.slice(0, 3).map((task) => (
              <article key={task.key} className="card card-signal">
                <div className="card-h band-signal">
                  <span className="msg-av" style={{ background: "#fff", color: "var(--signal)" }}>
                    <Icon name={task.kind === "approval" ? "erledigen" : "frage"} />
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>
                      {task.kind === "approval"
                        ? "Der Assistent braucht eine Freigabe"
                        : "Der Assistent hat eine Frage"}
                    </p>
                    <p className="meta">seit {formatDate(task.createdAt)}</p>
                  </div>
                </div>
                <div className="card-b" style={{ gap: 16 }}>
                  <div className="bubble-h">
                    {task.ticketId !== null ? (
                      <span className="tag">{buildTicketTag(task.ticketId)}</span>
                    ) : null}
                    <h2 style={{ fontSize: 20 }}>{task.title}</h2>
                    <UrgencyTag urgency={task.urgency} />
                  </div>
                  <p className="lead">{excerpt(task.text, 320)}</p>
                  <p className="meta">{task.who}</p>
                  <div className="row-wrap actions-stack">
                    <Link href="/zu-erledigen" className="btn btn-primary">
                      {task.kind === "approval" ? "Prüfen und freigeben" : "Antworten"}
                    </Link>
                    {task.ticketId !== null ? (
                      <Link href={`/vorgaenge/${task.ticketId}`} style={{ fontSize: 14 }}>
                        Erst den Schriftwechsel lesen
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        {tasks.length > 0 && recentlyClosed.length > 0 ? (
          <section className="card">
            <div className="card-h">
              <h2>Zuletzt erledigt</h2>
              <Link href="/vorgaenge" className="push" style={{ fontSize: "13.5px" }}>
                Alle Vorgänge
              </Link>
            </div>
            <ul className="rows">
              {recentlyClosed.map(({ ticket, tenantName }) => (
                <li key={ticket.id}>
                  <span className="tag">{buildTicketTag(ticket.id)}</span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>
                      <Link href={`/vorgaenge/${ticket.id}`}>{ticket.title}</Link>
                    </p>
                    <p className="meta">{tenantName}</p>
                  </div>
                  <StatusBadge status={ticket.status} />
                  <span className="meta hide-s" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(ticket.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasSystemIssue ? (
          <section className="stack-sm">
            <h2>Das sollten Sie sich ansehen</h2>

            {failedMessages.length > 0 ? (
              <div className="card">
                <div className="card-h">
                  <Icon name="warnung" className="icon icon-sm" />
                  <h3>Verarbeitung fehlgeschlagen</h3>
                  <span className="meta push">{failedMessages.length}</span>
                </div>
                <ul className="rows">
                  {failedMessages.map((m) => (
                    <li key={m.id}>
                      <div className="grow">
                        <p style={{ fontWeight: 700 }}>
                          {m.fromEmail} — {m.subject || "(kein Betreff)"}
                        </p>
                        <p className="meta">{m.processingError ?? "Unbekannter Fehler"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {stuckMessages.length > 0 ? (
              <div className="card">
                <div className="card-h">
                  <Icon name="clock" className="icon icon-sm" />
                  <h3>Hängt in Bearbeitung</h3>
                  <span className="meta push">{stuckMessages.length}</span>
                </div>
                <div className="card-b" style={{ paddingBottom: 4 }}>
                  <p className="muted">
                    Diese Nachrichten stehen seit mehr als fünf Minuten auf „in
                    Bearbeitung“ — vermutlich ist der Worker-Prozess in der Zwischenzeit
                    abgestürzt. Ein Neustart setzt sie automatisch zurück und verarbeitet
                    sie erneut.
                  </p>
                </div>
                <ul className="rows">
                  {stuckMessages.map((m) => (
                    <li key={m.id}>
                      <div className="grow">
                        <p style={{ fontWeight: 700 }}>
                          {m.fromEmail} — {m.subject || "(kein Betreff)"}
                        </p>
                        <p className="meta">seit {formatDate(m.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {unknownMessages.length > 0 ? (
              <div className="card">
                <div className="card-h">
                  <Icon name="mail" className="icon icon-sm" />
                  <h3>Post von unbekannten Absendern</h3>
                  <span className="meta push">{unknownMessages.length}</span>
                </div>
                <div className="card-b" style={{ paddingBottom: 4 }}>
                  <p className="muted">
                    Der Assistent antwortet nur Adressen aus Ihren Stammdaten. Diese
                    Nachrichten bleiben deshalb unbeantwortet liegen.
                  </p>
                </div>
                <ul className="rows">
                  {unknownMessages.map((m) => (
                    <li key={m.id} style={{ alignItems: "flex-start" }}>
                      <span className="msg-av av-unknown">
                        <Icon name="mail" className="icon icon-sm" />
                      </span>
                      <div className="grow stack-xs">
                        <p style={{ fontWeight: 700 }}>
                          {m.fromEmail} — {m.subject || "(kein Betreff)"}
                        </p>
                        <p className="meta">{formatDate(m.createdAt)}</p>
                        <p className="muted">{excerpt(m.body)}</p>
                        {knownEmails.has(m.fromEmail) ? (
                          <ActionForm action={reprocessMessage.bind(null, m.id)}>
                            <p className="meta" style={{ marginBottom: 8 }}>
                              Dieser Absender steht inzwischen in den Stammdaten.
                            </p>
                            <button type="submit" className="btn btn-ghost btn-sm">
                              Erneut zur Verarbeitung freigeben
                            </button>
                          </ActionForm>
                        ) : (
                          <Link href="/stammdaten" style={{ fontSize: "13.5px" }}>
                            In den Stammdaten anlegen
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="panel row-wrap" style={{ flexDirection: "row", alignItems: "center", gap: 22 }}>
          <span className="row" style={{ gap: 9 }}>
            <span style={{ color: setupComplete ? "var(--ok)" : "var(--signal)" }}>
              <Icon name={setupComplete ? "check" : "warnung"} className="icon icon-sm" />
            </span>
            <span style={{ fontWeight: 700 }}>
              {setupComplete ? "Eingerichtet" : "Einrichtung unvollständig"}
            </span>
          </span>
          <span className="row muted" style={{ gap: 8 }}>
            <Icon name="gebaeude" className="icon icon-sm" />
            {propertyCount} {propertyCount === 1 ? "Objekt" : "Objekte"}
          </span>
          <span className="row muted" style={{ gap: 8 }}>
            <Icon name="stammdaten" className="icon icon-sm" />
            {tenantCount} Mieter
          </span>
          <span className="row muted" style={{ gap: 8 }}>
            <Icon name="werkzeug" className="icon icon-sm" />
            {contractorCount} Handwerker
          </span>
          <span className="row muted" style={{ gap: 8 }}>
            <Icon name="dokumente" className="icon icon-sm" />
            {documentCount} {documentCount === 1 ? "Dokument" : "Dokumente"}
          </span>
          <Link href="/stammdaten" className="push" style={{ fontSize: "13.5px" }}>
            Prüfen
          </Link>
        </div>
      </main>
    </>
  );
}
