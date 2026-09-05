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
import { roleLabel, formatDate } from "@/lib/format";
import { sendManualReply, setTicketStatus } from "@/app/actions/tickets";
import { fail, type ActionResult } from "@/lib/actionResult";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";
import { StatusBadge, STATUS_STYLES, UrgencyTag } from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

const AVATAR_CLASS: Record<string, string> = {
  tenant: "av-tenant",
  contractor: "av-contractor",
  landlord: "av-landlord",
  ai: "av-ai",
  unknown: "av-unknown",
};

function initials(role: string, email: string): string {
  if (role === "ai") return "KI";
  const local = email.split("@")[0] ?? "";
  return (local.slice(0, 1) || "?").toUpperCase();
}

async function changeStatusAction(formData: FormData): Promise<ActionResult> {
  "use server";
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("status") ?? "");
  if (!(TICKET_STATUSES as readonly string[]).includes(raw)) {
    return fail(`Unbekannter Status: ${raw}`);
  }
  return setTicketStatus(ticketId, raw as TicketStatus);
}

async function manualReplyAction(formData: FormData): Promise<ActionResult> {
  "use server";
  const ticketId = Number(formData.get("ticketId"));
  const text = String(formData.get("text") ?? "");
  return sendManualReply(ticketId, text);
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
  // or(...) fehlte der komplette Handwerker-Teil.
  const messageRows = db
    .select()
    .from(messages)
    .where(
      or(eq(messages.conversationId, ticket.conversationId), eq(messages.ticketId, ticket.id)),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .all();

  const messageIds = messageRows.map((m) => m.id);
  const attachmentRows =
    messageIds.length > 0
      ? db.select().from(attachments).where(inArray(attachments.messageId, messageIds)).all()
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

  const openApproval = approvalRows.find((a) => a.approval.status === "offen");
  const openEscalation = escalationRows.find((e) => e.status === "offen");

  let collectedInfo: Record<string, string> = {};
  try {
    collectedInfo = JSON.parse(ticket.collectedInfo) as Record<string, string>;
  } catch {
    collectedInfo = {};
  }
  const infoEntries = Object.entries(collectedInfo);

  return (
    <>
      <header className="top">
        <div className="top-text">
          <Link href="/app/vorgaenge" className="row" style={{ gap: 6, fontSize: "13.5px" }}>
            <Icon name="zurueck" className="icon icon-sm" />
            Zurück zu den Vorgängen
          </Link>
          <div className="bubble-h" style={{ marginTop: 4 }}>
            <span className="tag">{buildTicketTag(ticket.id)}</span>
            <h1>{ticket.title}</h1>
            <StatusBadge status={ticket.status} />
            <UrgencyTag urgency={ticket.urgency} />
          </div>
          <p className="meta">
            {tenant ? tenant.name : "Mieter unbekannt"}
            {tenant?.unitLabel ? ` · ${tenant.unitLabel}` : ""} · gemeldet{" "}
            {formatDate(ticket.createdAt)}
          </p>
        </div>
        {openApproval || openEscalation ? (
          <Link href="/app/zu-erledigen" className="btn btn-primary">
            {openApproval ? "Prüfen und freigeben" : "Rückfrage beantworten"}
          </Link>
        ) : null}
      </header>

      <main className="main">
        <div className="cols">
          <div className="stack">
            <section className="card">
              <div className="card-h">
                <h2>Was bisher geschrieben wurde</h2>
                <span className="meta push">
                  {messageRows.length} {messageRows.length === 1 ? "Nachricht" : "Nachrichten"}
                </span>
              </div>
              <div className="card-b">
                {messageRows.length === 0 ? (
                  <p className="meta">Noch keine Nachrichten.</p>
                ) : (
                  <ul className="thread">
                    {messageRows.map((m) => {
                      const files = attachmentsByMessage.get(m.id) ?? [];
                      return (
                        <li key={m.id} className="msg">
                          <span className={`msg-av ${AVATAR_CLASS[m.role] ?? "av-unknown"}`}>
                            {initials(m.role, m.fromEmail)}
                          </span>
                          <div className={`bubble${m.role === "ai" ? " bubble-ai" : ""}`}>
                            <div className="bubble-h">
                              <span style={{ fontWeight: 700 }}>{roleLabel(m.role)}</span>
                              <span className="eyebrow">
                                {m.direction === "inbound" ? "eingehend" : "ausgehend"}
                              </span>
                              <span className="meta push">{formatDate(m.createdAt)}</span>
                            </div>
                            <p className="meta">
                              {m.fromEmail} → {m.toEmail}
                              {m.subject ? ` · ${m.subject}` : ""}
                            </p>
                            <p className="bubble-body">{m.body}</p>
                            {files.length > 0 ? (
                              <div className="row-wrap" style={{ gap: 8, marginTop: 3 }}>
                                {files.map((a) => (
                                  <span key={a.id} className="chip chip-static btn-sm">
                                    <Icon name="anhang" className="icon icon-sm" />
                                    {a.filename}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {openApproval ? (
                  <div className="note note-warn note-c">
                    <Icon name="erledigen" />
                    <div className="grow">
                      <p style={{ fontWeight: 700 }}>Hier wartet der Vorgang auf Sie.</p>
                      <p style={{ fontSize: "13.5px" }}>
                        Erst nach Ihrer Freigabe geht die Mail an{" "}
                        {openApproval.contractorName}.
                      </p>
                    </div>
                    <Link href="/app/zu-erledigen" className="btn btn-sm btn-ghost">
                      Freigeben
                    </Link>
                  </div>
                ) : null}

                {openEscalation ? (
                  <div className="note note-warn note-c">
                    <Icon name="frage" />
                    <div className="grow">
                      <p style={{ fontWeight: 700 }}>Der Assistent hat eine Frage an Sie.</p>
                      <p style={{ fontSize: "13.5px" }}>{openEscalation.question}</p>
                    </div>
                    <Link href="/app/zu-erledigen" className="btn btn-sm btn-ghost">
                      Antworten
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="card">
              <div className="card-h">
                <h2>Selbst antworten</h2>
                <span className="meta push">
                  Geht als E-Mail an {tenant ? tenant.name : "den Mieter"}
                </span>
              </div>
              <div className="card-b">
                <ActionForm action={manualReplyAction} className="stack-sm">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <label className="label" htmlFor="text">
                    Ihre Nachricht
                  </label>
                  <textarea
                    id="text"
                    className="field"
                    name="text"
                    required
                    rows={4}
                    placeholder="Nur nötig, wenn Sie etwas persönlich schreiben möchten …"
                  />
                  <div className="row-wrap actions-stack">
                    <span className="meta">
                      Der Assistent liest mit und führt den Dialog danach weiter.
                    </span>
                    <button type="submit" className="btn btn-ghost push">
                      <Icon name="senden" className="icon icon-sm" />
                      Antwort senden
                    </button>
                  </div>
                </ActionForm>
              </div>
            </section>

            {approvalRows.length > 0 ? (
              <section className="card">
                <div className="card-h">
                  <h2>Freigaben zu diesem Vorgang</h2>
                </div>
                <ul className="rows">
                  {approvalRows.map(({ approval, contractorName }) => (
                    <li key={approval.id} style={{ alignItems: "flex-start" }}>
                      <div className="grow stack-xs">
                        <div className="row-wrap">
                          <span style={{ fontWeight: 700 }}>{contractorName}</span>
                          <span className="badge s-neu">{approval.status}</span>
                          {approval.decidedAt ? (
                            <span className="meta">
                              entschieden {formatDate(approval.decidedAt)}
                            </span>
                          ) : null}
                        </div>
                        <p className="muted pre">{approval.summary}</p>
                        {approval.decisionNote ? (
                          <p className="meta">Begründung: {approval.decisionNote}</p>
                        ) : null}
                        {approval.status === "offen" ? (
                          <Link href="/app/zu-erledigen" style={{ fontSize: "13.5px" }}>
                            Jetzt entscheiden
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {escalationRows.length > 0 ? (
              <section className="card">
                <div className="card-h">
                  <h2>Rückfragen zu diesem Vorgang</h2>
                </div>
                <ul className="rows">
                  {escalationRows.map((e) => (
                    <li key={e.id} style={{ alignItems: "flex-start" }}>
                      <div className="grow stack-xs">
                        <div className="row-wrap">
                          <span className="meta">{formatDate(e.createdAt)}</span>
                          {e.status === "offen" ? (
                            <span className="badge s-esc">offen</span>
                          ) : null}
                        </div>
                        <p className="muted">„{e.question}“</p>
                        {e.answer ? (
                          <div className="note note-ok" style={{ padding: "11px 14px" }}>
                            <Icon name="check" className="icon icon-sm" />
                            <p className="pre">{e.answer}</p>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="card-h">
                <h2>Worum es geht</h2>
              </div>
              <div className="card-b" style={{ gap: 12 }}>
                {ticket.summary ? (
                  <div>
                    <p className="eyebrow">Zusammenfassung</p>
                    <p className="pre">{ticket.summary}</p>
                  </div>
                ) : null}
                {infoEntries.length === 0 ? (
                  <p className="meta">Der Assistent hat noch keine Details gesammelt.</p>
                ) : (
                  infoEntries.map(([key, value]) => (
                    <div key={key}>
                      <p className="eyebrow">{key}</p>
                      <p className="pre">{value}</p>
                    </div>
                  ))
                )}
                {ticket.appointmentAt ? (
                  <div>
                    <p className="eyebrow">Termin</p>
                    <p>{ticket.appointmentAt}</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="card">
              <div className="card-h">
                <h2>Beteiligte</h2>
              </div>
              <div className="card-b" style={{ gap: 14 }}>
                <div className="row">
                  <span className="msg-av av-tenant">
                    {tenant ? tenant.name.slice(0, 1).toUpperCase() : "?"}
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>{tenant ? tenant.name : "Unbekannt"}</p>
                    <p className="meta">
                      {tenant ? tenant.email : "—"}
                      {tenant?.unitLabel ? ` · ${tenant.unitLabel}` : ""}
                    </p>
                  </div>
                </div>
                <div className="row">
                  <span className="msg-av av-contractor">
                    <Icon name="werkzeug" className="icon icon-sm" />
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>
                      {contractor ? contractor.name : "Noch kein Handwerker"}
                    </p>
                    <p className="meta">
                      {contractor
                        ? `${contractor.trade} · ${contractor.email}`
                        : "wird erst nach Ihrer Freigabe beauftragt"}
                    </p>
                  </div>
                </div>
                <div className="row">
                  <span className="msg-av av-unknown">
                    <Icon name="gebaeude" className="icon icon-sm" />
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>{property?.address ?? "Objekt unbekannt"}</p>
                    <p className="meta">Art: {ticket.type}</p>
                  </div>
                </div>
              </div>
            </section>

            <details className="card">
              <summary
                style={{
                  cursor: "pointer",
                  padding: "16px 20px",
                  fontWeight: 500,
                  fontSize: "13.5px",
                }}
              >
                Status von Hand setzen
              </summary>
              <div className="card-b" style={{ paddingTop: 0 }}>
                <p className="meta">
                  Nur nötig, wenn Sie etwas außerhalb des Systems geklärt haben.
                </p>
                <ActionForm action={changeStatusAction} className="stack-sm">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <select
                    id="status"
                    name="status"
                    className="field"
                    defaultValue={ticket.status}
                    aria-label="Neuer Status"
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_STYLES[s]?.label ?? s}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-ghost btn-block">
                    Status übernehmen
                  </button>
                </ActionForm>
              </div>
            </details>
          </div>
        </div>
      </main>
    </>
  );
}
