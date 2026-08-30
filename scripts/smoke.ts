import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, contractors, messages, tenants, tickets } from "@/db/schema";
import { getEnv } from "@/env";
import type { IncomingEmail, OutgoingEmail } from "@/channel/types";
import { ingestEmail, processPendingMessages } from "@/worker/processor";

async function main(): Promise<void> {
  console.log("=== KI-Hausverwaltung — Smoke-Test (End-to-End ohne IMAP/SMTP) ===\n");
  console.log("Hinweis: benötigt einen gültigen ANTHROPIC_API_KEY und kostet echte API-Tokens.");
  console.log("Es wird NICHTS versendet — ausgehende Mails erscheinen nur auf der Konsole.");
  console.log("Das Skript schreibt in die konfigurierte Datenbank (DATABASE_PATH).\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("FEHLER: ANTHROPIC_API_KEY ist nicht gesetzt. Bitte .env prüfen.");
    process.exit(1);
  }

  const env = getEnv();
  const db = getDb();

  const tenant = db.select().from(tenants).orderBy(tenants.id).limit(1).get();
  if (!tenant) {
    console.error("FEHLER: Keine Mieter in der Datenbank gefunden.");
    console.error("Bitte zuerst `npm run seed` ausführen.");
    process.exit(1);
  }

  const mail: IncomingEmail = {
    messageId: `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    from: tenant.email,
    to: [env.MAIL_ALIAS.toLowerCase()],
    subject: "Problem mit meinem Türschloss",
    text: "Guten Tag, mein Türschloss klemmt seit gestern stark, ich bekomme die Tür kaum noch auf. Was soll ich tun?",
    date: new Date(),
    attachments: [],
  };

  console.log(`Eingehende Test-Mail von ${tenant.name} <${tenant.email}> wird eingespielt …`);
  const ingestedId = await ingestEmail(mail);
  if (ingestedId === null) {
    console.error("FEHLER: Mail wurde als Duplikat verworfen — das sollte hier nicht passieren.");
    process.exit(1);
  }
  console.log(`Message #${ingestedId} gespeichert. Agent-Lauf startet (echter API-Aufruf) …\n`);

  const consoleSend = async (outgoing: OutgoingEmail): Promise<void> => {
    console.log("┌── AUSGEHENDE MAIL (NUR KONSOLE, NICHT GESENDET) ──");
    console.log(`│ An:      ${outgoing.to}`);
    console.log(`│ Betreff: ${outgoing.subject}`);
    console.log("│");
    for (const line of outgoing.text.split("\n")) {
      console.log(`│ ${line}`);
    }
    console.log("└───────────────────────────────────────────────────\n");
  };

  await processPendingMessages({ sendFn: consoleSend });

  console.log("\n=== ERGEBNIS ===\n");

  const allTickets = db.select().from(tickets).orderBy(tickets.id).all();
  console.log(`Tickets (${allTickets.length}):`);
  for (const t of allTickets) {
    console.log(`  [HV-${t.id}] ${t.title}`);
    console.log(`    Typ: ${t.type} | Status: ${t.status} | Dringlichkeit: ${t.urgency ?? "–"}`);
    console.log(`    Gesammelte Infos: ${t.collectedInfo}`);
  }

  const allMessages = db.select().from(messages).orderBy(messages.id).all();
  console.log(`\nNachrichten (${allMessages.length}):`);
  for (const m of allMessages) {
    const preview = m.body.replace(/\s+/g, " ").slice(0, 100);
    console.log(`  #${m.id} ${m.direction}/${m.role} ${m.fromEmail} → ${m.toEmail} [${m.processingStatus}]`);
    console.log(`    Betreff: ${m.subject ?? "–"}`);
    console.log(`    ${preview}${m.body.length > 100 ? " …" : ""}`);
  }

  const allApprovals = db.select().from(approvals).orderBy(approvals.id).all();
  console.log(`\nGenehmigungsanträge (${allApprovals.length}):`);
  for (const a of allApprovals) {
    const contractor = db
      .select()
      .from(contractors)
      .where(eq(contractors.id, a.contractorId))
      .get();
    console.log(`  #${a.id} zu Ticket [HV-${a.ticketId}] — Status: ${a.status}`);
    console.log(`    Zusammenfassung: ${a.summary}`);
    console.log(
      `    Handwerker: ${contractor ? `${contractor.name} (${contractor.trade})` : `Id ${a.contractorId}`}`,
    );
    console.log(`    Mail-Entwurf-Betreff: ${a.emailSubject}`);
  }

  console.log("\nSmoke-Test abgeschlossen. Details im Dashboard: http://localhost:3000");
}

main().catch((err: unknown) => {
  console.error("Smoke-Test fehlgeschlagen:", err);
  process.exit(1);
});
