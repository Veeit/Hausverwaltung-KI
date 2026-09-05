import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const now = () => new Date().toISOString();

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),          // immer lowercase speichern
  propertyId: integer("property_id").notNull().references(() => properties.id),
  unitLabel: text("unit_label"),
  phone: text("phone"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const contractors = sqliteTable("contractors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),          // immer lowercase speichern
  trade: text("trade").notNull(),                   // Gewerk, Freitext: "Sanitär", "Elektrik", "Schlüsseldienst" …
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const waitlist = sqliteTable("waitlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),          // immer lowercase speichern
  units: text("units"),                             // UnitBucket | null, siehe src/lib/waitlist.ts
  wantsDemo: integer("wants_demo").notNull().default(0), // 0 | 1 — Demo des laufenden Systems gewünscht
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  counterpartType: text("counterpart_type").notNull(), // 'tenant' | 'contractor' | 'unknown'
  counterpartId: integer("counterpart_id"),            // tenants.id bzw. contractors.id, null bei unknown
  counterpartEmail: text("counterpart_email").notNull().unique(), // lowercase
  subject: text("subject"),
  lastMessageAt: text("last_message_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  type: text("type").notNull(),                     // TicketType
  status: text("status").notNull().default("neu"),  // TicketStatus
  title: text("title").notNull(),
  summary: text("summary"),
  urgency: text("urgency"),                         // Urgency | null
  collectedInfo: text("collected_info").notNull().default("{}"), // JSON: Record<string,string>
  contractorId: integer("contractor_id").references(() => contractors.id),
  appointmentAt: text("appointment_at"),            // Freitext oder ISO
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  ticketId: integer("ticket_id").references(() => tickets.id),
  direction: text("direction").notNull(),           // 'inbound' | 'outbound'
  role: text("role").notNull(),                     // 'tenant' | 'contractor' | 'landlord' | 'ai' | 'unknown'
  fromEmail: text("from_email").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  imapMessageId: text("imap_message_id").unique(),  // Message-ID-Header (nur inbound); Dedupe
  processingStatus: text("processing_status").notNull().default("pending"),
  // inbound: 'pending' | 'processing' | 'done' | 'failed' — outbound: 'sending' | 'done' | 'failed'
  processingAttempts: integer("processing_attempts").notNull().default(0),
  processingError: text("processing_error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull().references(() => messages.id),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),            // relativ zu ATTACHMENTS_DIR ODER absolut — wir speichern absolut
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull().references(() => tickets.id),
  summary: text("summary").notNull(),
  contractorId: integer("contractor_id").notNull().references(() => contractors.id),
  emailSubject: text("email_subject").notNull(),
  emailBody: text("email_body").notNull(),
  status: text("status").notNull().default("offen"), // 'offen' | 'genehmigt' | 'abgelehnt'
  decisionNote: text("decision_note"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const escalations = sqliteTable("escalations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").references(() => tickets.id),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  question: text("question").notNull(),
  answer: text("answer"),
  status: text("status").notNull().default("offen"), // 'offen' | 'beantwortet'
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Row-Typen für alle Konsumenten:
export type PropertyRow = typeof properties.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type ContractorRow = typeof contractors.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type EscalationRow = typeof escalations.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
