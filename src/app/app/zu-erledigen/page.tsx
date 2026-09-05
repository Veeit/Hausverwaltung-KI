import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  approvals,
  contractors,
  conversations,
  escalations,
  properties,
  tenants,
  tickets,
  type ApprovalRow,
  type EscalationRow,
  type TicketRow,
} from "@/db/schema";
import { buildTicketTag } from "@/lib/subject";
import { formatDate } from "@/lib/format";
import { fail, type ActionResult } from "@/lib/actionResult";
import {
  approveApproval,
  rejectApproval,
  updateApprovalDraft,
} from "@/app/actions/approvals";
import { answerEscalation } from "@/app/actions/escalations";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";
import { UrgencyTag } from "@/app/components/StatusBadge";

export const dynamic = "force-dynamic";

/**
 * Genehmigungen und Rückfragen an einem Ort. Für einen privaten Vermieter ist
 * beides derselbe Vorgang — der Assistent kommt nicht weiter und braucht ihn.
 * Die alten Pfade /genehmigungen und /eskalationen leiten hierher.
 */

async function saveDraftAction(formData: FormData): Promise<ActionResult> {
  "use server";
  const approvalId = Number(formData.get("approvalId"));
  return updateApprovalDraft(
    approvalId,
    String(formData.get("emailSubject") ?? ""),
    String(formData.get("emailBody") ?? ""),
  );
}

async function approveAction(formData: FormData): Promise<ActionResult> {
  "use server";
  return approveApproval(Number(formData.get("approvalId")));
}

async function rejectAction(formData: FormData): Promise<ActionResult> {
  "use server";
  const note = String(formData.get("note") ?? "").trim();
  if (!note) {
    return fail("Bitte eine Begründung für die Ablehnung angeben.");
  }
  return rejectApproval(Number(formData.get("approvalId")), note);
}

async function answerAction(formData: FormData): Promise<ActionResult> {
  "use server";
  return answerEscalation(
    Number(formData.get("escalationId")),
    String(formData.get("answer") ?? ""),
  );
}

interface ApprovalItem {
  kind: "approval";
  createdAt: string;
  approval: ApprovalRow;
  ticket: TicketRow;
  tenantName: string;
  tenantUnit: string | null;
  propertyAddress: string;
  contractorName: string;
  contractorTrade: string;
  contractorEmail: string;
}

interface EscalationItem {
  kind: "escalation";
  createdAt: string;
  escalation: EscalationRow;
  ticket: TicketRow | null;
  who: string;
}

export default function ZuErledigenPage() {
  const db = getDb();

  const approvalItems: ApprovalItem[] = db
    .select({
      approval: approvals,
      ticket: tickets,
      tenantName: tenants.name,
      tenantUnit: tenants.unitLabel,
      propertyAddress: properties.address,
      contractorName: contractors.name,
      contractorTrade: contractors.trade,
      contractorEmail: contractors.email,
    })
    .from(approvals)
    .innerJoin(tickets, eq(approvals.ticketId, tickets.id))
    .innerJoin(tenants, eq(tickets.tenantId, tenants.id))
    .innerJoin(properties, eq(tenants.propertyId, properties.id))
    .innerJoin(contractors, eq(approvals.contractorId, contractors.id))
    .where(eq(approvals.status, "offen"))
    .orderBy(asc(approvals.createdAt))
    .all()
    .map((row) => ({ kind: "approval" as const, createdAt: row.approval.createdAt, ...row }));

  const escalationItems: EscalationItem[] = db
    .select({
      escalation: escalations,
      ticket: tickets,
      tenantName: tenants.name,
      tenantUnit: tenants.unitLabel,
      counterpartEmail: conversations.counterpartEmail,
    })
    .from(escalations)
    .leftJoin(tickets, eq(escalations.ticketId, tickets.id))
    .leftJoin(tenants, eq(tickets.tenantId, tenants.id))
    .leftJoin(conversations, eq(escalations.conversationId, conversations.id))
    .where(eq(escalations.status, "offen"))
    .orderBy(asc(escalations.createdAt))
    .all()
    .map((row) => ({
      kind: "escalation" as const,
      createdAt: row.escalation.createdAt,
      escalation: row.escalation,
      ticket: row.ticket,
      who: [row.tenantName ?? row.counterpartEmail ?? "Unbekannt", row.tenantUnit]
        .filter(Boolean)
        .join(" · "),
    }));

  const items = [...approvalItems, ...escalationItems].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const answered = db
    .select({ escalation: escalations, ticket: tickets })
    .from(escalations)
    .leftJoin(tickets, eq(escalations.ticketId, tickets.id))
    .where(eq(escalations.status, "beantwortet"))
    .orderBy(desc(escalations.answeredAt))
    .limit(5)
    .all();

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Zu erledigen</h1>
          <p className="meta">
            {items.length === 0
              ? "Der Assistent kommt gerade allein zurecht"
              : items.length === 1
                ? "Eine Entscheidung wartet auf Sie"
                : `${items.length} Entscheidungen warten auf Sie`}
          </p>
        </div>
      </header>

      <main className="main main-narrow">
        {items.length === 0 ? (
          <section className="card">
            <div className="empty">
              <span className="empty-mark">
                <Icon name="check" />
              </span>
              <h2 style={{ fontSize: "22px" }}>Nichts zu tun.</h2>
              <p className="lead" style={{ maxWidth: "48ch" }}>
                Sobald der Assistent eine Freigabe braucht oder nicht weiterweiß,
                erscheint es hier — und nur hier.
              </p>
            </div>
          </section>
        ) : (
          <div className="note note-accent note-c">
            <Icon name="schloss" />
            <p>
              Eine E-Mail an einen Handwerker verlässt das System ausschließlich nach
              Ihrer Freigabe. Bis dahin weiß der Handwerker nichts von dem Vorgang.
            </p>
          </div>
        )}

        {items.map((item) =>
          item.kind === "approval" ? (
            <article key={`a-${item.approval.id}`} className="card card-signal">
              <div className="card-h card-h-top band-signal">
                <span className="msg-av" style={{ background: "#fff", color: "var(--signal)" }}>
                  <Icon name="erledigen" />
                </span>
                <div className="grow">
                  <div className="bubble-h">
                    <span className="tag">{buildTicketTag(item.ticket.id)}</span>
                    <h2>{item.ticket.title}</h2>
                    <UrgencyTag urgency={item.ticket.urgency} />
                  </div>
                  <p className="meta">
                    {item.tenantName}
                    {item.tenantUnit ? `, ${item.tenantUnit}` : ""} · beantragt{" "}
                    {formatDate(item.approval.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/app/vorgaenge/${item.ticket.id}`}
                  style={{ fontSize: "13.5px", whiteSpace: "nowrap" }}
                >
                  Schriftwechsel lesen
                </Link>
              </div>

              <div className="card-b" style={{ gap: 20 }}>
                <div className="panel">
                  <p className="eyebrow">Das schlägt der Assistent vor</p>
                  <p className="pre" style={{ fontSize: 15 }}>
                    {item.approval.summary}
                  </p>
                  <div
                    className="grid-2"
                    style={{
                      gap: 14,
                      paddingTop: 11,
                      borderTop: "1px solid var(--line-2)",
                    }}
                  >
                    <div>
                      <p className="eyebrow">Geht an</p>
                      <p style={{ fontWeight: 500 }}>{item.contractorName}</p>
                      <p className="meta">
                        {item.contractorTrade} · {item.contractorEmail}
                      </p>
                    </div>
                    <div>
                      <p className="eyebrow">Objekt</p>
                      <p style={{ fontWeight: 500 }}>{item.propertyAddress}</p>
                      <p className="meta">
                        {item.tenantUnit ? `Wohnung: ${item.tenantUnit}` : "Wohnung nicht hinterlegt"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="stack-sm">
                  <h3>Diese E-Mail geht raus</h3>
                  <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", overflow: "hidden" }}>
                    <p
                      className="meta"
                      style={{
                        padding: "11px 15px",
                        background: "var(--surface-2)",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      Betreff: {item.approval.emailSubject}
                    </p>
                    <p className="bubble-body" style={{ padding: "15px 17px", fontSize: "13.5px" }}>
                      {item.approval.emailBody}
                    </p>
                  </div>

                  <details>
                    <summary
                      style={{ cursor: "pointer", fontWeight: 500, fontSize: "13.5px", padding: "6px 0" }}
                    >
                      Text anpassen
                    </summary>
                    <ActionForm action={saveDraftAction} className="stack-sm" >
                      <input type="hidden" name="approvalId" value={item.approval.id} />
                      <div style={{ marginTop: 12 }}>
                        <label className="label" htmlFor={`subject-${item.approval.id}`}>
                          Betreff
                        </label>
                        <input
                          id={`subject-${item.approval.id}`}
                          className="field"
                          type="text"
                          name="emailSubject"
                          required
                          defaultValue={item.approval.emailSubject}
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`body-${item.approval.id}`}>
                          Nachricht an den Handwerker
                        </label>
                        <textarea
                          id={`body-${item.approval.id}`}
                          className="field"
                          name="emailBody"
                          required
                          rows={14}
                          defaultValue={item.approval.emailBody}
                        />
                      </div>
                      <div className="row-wrap">
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Entwurf speichern
                        </button>
                        <span className="meta">
                          Erst speichern, dann freigeben — verschickt wird der
                          gespeicherte Text.
                        </span>
                      </div>
                    </ActionForm>
                  </details>
                </div>
              </div>

              <div className="card-f actions-stack" style={{ gap: 14 }}>
                <ActionForm action={approveAction}>
                  <input type="hidden" name="approvalId" value={item.approval.id} />
                  <button type="submit" className="btn btn-primary">
                    <Icon name="senden" className="icon icon-sm" />
                    Freigeben und E-Mail senden
                  </button>
                </ActionForm>

                <ActionForm action={rejectAction} className="row-wrap" >
                  <input type="hidden" name="approvalId" value={item.approval.id} />
                  <input
                    className="field field-sm field-inline"
                    type="text"
                    name="note"
                    required
                    placeholder="Grund der Ablehnung"
                    aria-label="Grund der Ablehnung"
                  />
                  <button type="submit" className="btn btn-danger btn-sm">
                    Ablehnen
                  </button>
                </ActionForm>
              </div>
            </article>
          ) : (
            <article key={`e-${item.escalation.id}`} className="card card-signal">
              <div className="card-h card-h-top band-signal">
                <span className="msg-av" style={{ background: "#fff", color: "var(--signal)" }}>
                  <Icon name="frage" />
                </span>
                <div className="grow">
                  <div className="bubble-h">
                    {item.ticket ? (
                      <span className="tag">{buildTicketTag(item.ticket.id)}</span>
                    ) : null}
                    <h2>{item.ticket ? item.ticket.title : "Rückfrage ohne Vorgang"}</h2>
                    {item.ticket ? <UrgencyTag urgency={item.ticket.urgency} /> : null}
                  </div>
                  <p className="meta">
                    {item.who} · gefragt {formatDate(item.escalation.createdAt)}
                  </p>
                </div>
                {item.ticket ? (
                  <Link
                    href={`/app/vorgaenge/${item.ticket.id}`}
                    style={{ fontSize: "13.5px", whiteSpace: "nowrap" }}
                  >
                    Schriftwechsel lesen
                  </Link>
                ) : null}
              </div>

              <div className="card-b" style={{ gap: 18 }}>
                <div className="msg">
                  <span className="msg-av av-ai">KI</span>
                  <div className="bubble bubble-ai">
                    <p className="bubble-body" style={{ color: "var(--ink)", fontSize: 15 }}>
                      {item.escalation.question}
                    </p>
                  </div>
                </div>

                <ActionForm action={answerAction} className="stack-sm">
                  <input type="hidden" name="escalationId" value={item.escalation.id} />
                  <div>
                    <label className="label" htmlFor={`answer-${item.escalation.id}`}>
                      Ihre Antwort an den Assistenten
                    </label>
                    <textarea
                      id={`answer-${item.escalation.id}`}
                      className="field"
                      name="answer"
                      required
                      rows={4}
                      placeholder="Kurz und klar — der Assistent formuliert daraus die Nachricht an den Mieter."
                    />
                  </div>
                  <div className="row-wrap actions-stack">
                    <p className="meta" style={{ maxWidth: "44ch" }}>
                      Ihre Antwort geht nicht an den Mieter, sondern an den Assistenten.
                      Er formuliert daraus die nächste Nachricht.
                    </p>
                    <button type="submit" className="btn btn-primary push">
                      <Icon name="senden" className="icon icon-sm" />
                      Antwort geben
                    </button>
                  </div>
                </ActionForm>
              </div>
            </article>
          ),
        )}

        {answered.length > 0 ? (
          <section className="card">
            <div className="card-h">
              <h2>Frühere Rückfragen</h2>
              <span className="meta push">{answered.length}</span>
            </div>
            <ul className="rows">
              {answered.map(({ escalation, ticket }) => (
                <li key={escalation.id} style={{ alignItems: "flex-start" }}>
                  <div className="grow stack-xs">
                    <div className="row-wrap">
                      {ticket ? <span className="tag">{buildTicketTag(ticket.id)}</span> : null}
                      <span className="meta push">
                        beantwortet{" "}
                        {escalation.answeredAt ? formatDate(escalation.answeredAt) : "—"}
                      </span>
                    </div>
                    <p className="muted">„{escalation.question}“</p>
                    {escalation.answer ? (
                      <div className="note note-ok" style={{ padding: "11px 14px" }}>
                        <Icon name="check" className="icon icon-sm" />
                        <p className="pre">{escalation.answer}</p>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
