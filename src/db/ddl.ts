// Handgeschriebene DDL — MUSS spaltengenau zu src/db/schema.ts passen.
// Jede Änderung hier erfordert dieselbe Änderung im Drizzle-Schema (und umgekehrt).
// Drift-Wächter: tests/db/schema.test.ts (Insert+Select über Drizzle je Tabelle).
export const DDL_SQL = `
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  unit_label TEXT,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  trade TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  units TEXT,
  wants_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  counterpart_type TEXT NOT NULL,
  counterpart_id INTEGER,
  counterpart_email TEXT NOT NULL UNIQUE,
  subject TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'neu',
  title TEXT NOT NULL,
  summary TEXT,
  urgency TEXT,
  collected_info TEXT NOT NULL DEFAULT '{}',
  contractor_id INTEGER REFERENCES contractors(id),
  appointment_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  ticket_id INTEGER REFERENCES tickets(id),
  direction TEXT NOT NULL,
  role TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  imap_message_id TEXT UNIQUE,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  processing_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  summary TEXT NOT NULL,
  contractor_id INTEGER NOT NULL REFERENCES contractors(id),
  email_subject TEXT NOT NULL,
  email_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen',
  decision_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER REFERENCES tickets(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'offen',
  answered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(content, document_id UNINDEXED);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(processing_status);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
`;
