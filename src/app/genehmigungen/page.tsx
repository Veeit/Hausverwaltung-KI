import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, contractors, properties, tenants, tickets } from "@/db/schema";
import { buildTicketTag } from "@/lib/subject";
import { formatDate } from "@/lib/format";
import {
  approveApproval,
  rejectApproval,
  updateApprovalDraft,
} from "@/app/actions/approvals";
import { fail, type ActionResult } from "@/lib/actionResult";
import { ActionForm } from "@/app/components/ActionForm";

export const dynamic = "force-dynamic";

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

export default function GenehmigungenPage() {
  const db = getDb();
  const rows = db
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
    .all();

  return (
    <main className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Genehmigungen</h1>
      {rows.length === 0 ? (
        <p className="text-gray-500">Keine offenen Genehmigungsanträge.</p>
      ) : (
        <ul className="space-y-6">
          {rows.map((row) => (
            <li key={row.approval.id} className="border border-gray-300 rounded p-4">
              <header className="mb-3">
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/vorgaenge/${row.ticket.id}`}
                    className="underline"
                  >
                    <span className="font-mono">{buildTicketTag(row.ticket.id)}</span>{" "}
                    {row.ticket.title}
                  </Link>
                </h2>
                <p className="text-sm text-gray-500">
                  Beantragt am {formatDate(row.approval.createdAt)}
                </p>
              </header>

              <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm mb-4">
                <dt className="font-medium">Zusammenfassung</dt>
                <dd className="whitespace-pre-wrap">{row.approval.summary}</dd>
                <dt className="font-medium">Dringlichkeit</dt>
                <dd>{row.ticket.urgency ?? "—"}</dd>
                <dt className="font-medium">Mieter</dt>
                <dd>
                  {row.tenantName}
                  {row.tenantUnit ? `, Wohnung: ${row.tenantUnit}` : ""}
                </dd>
                <dt className="font-medium">Objekt</dt>
                <dd>{row.propertyAddress}</dd>
                <dt className="font-medium">Handwerker</dt>
                <dd>
                  {row.contractorName} ({row.contractorTrade}, {row.contractorEmail})
                </dd>
              </dl>

              <ActionForm action={saveDraftAction} className="space-y-2 mb-4">
                <input type="hidden" name="approvalId" value={row.approval.id} />
                <label
                  htmlFor={`subject-${row.approval.id}`}
                  className="block text-sm font-medium"
                >
                  Betreff der Handwerker-Mail:
                </label>
                <input
                  id={`subject-${row.approval.id}`}
                  type="text"
                  name="emailSubject"
                  required
                  defaultValue={row.approval.emailSubject}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <label
                  htmlFor={`body-${row.approval.id}`}
                  className="block text-sm font-medium"
                >
                  Mail-Entwurf an den Handwerker:
                </label>
                <textarea
                  id={`body-${row.approval.id}`}
                  name="emailBody"
                  required
                  rows={8}
                  defaultValue={row.approval.emailBody}
                  className="w-full border border-gray-300 rounded p-2 text-sm font-mono"
                />
                <button
                  type="submit"
                  className="bg-gray-800 text-white rounded px-3 py-1 text-sm"
                >
                  Entwurf speichern
                </button>
              </ActionForm>

              <div className="flex flex-wrap items-end gap-4">
                <ActionForm action={approveAction}>
                  <input type="hidden" name="approvalId" value={row.approval.id} />
                  <button
                    type="submit"
                    className="bg-green-700 text-white rounded px-3 py-1 text-sm"
                  >
                    Genehmigen und Mail senden
                  </button>
                </ActionForm>

                <ActionForm action={rejectAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="approvalId" value={row.approval.id} />
                  <div>
                    <label
                      htmlFor={`note-${row.approval.id}`}
                      className="block text-sm font-medium"
                    >
                      Begründung:
                    </label>
                    <input
                      id={`note-${row.approval.id}`}
                      type="text"
                      name="note"
                      required
                      placeholder="Warum wird abgelehnt?"
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-64"
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-red-700 text-white rounded px-3 py-1 text-sm"
                  >
                    Ablehnen
                  </button>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
