const TICKET_TAG_REGEX = /\[HV-(\d+)\]/i;

export function buildTicketTag(ticketId: number): string {
  return `[HV-${ticketId}]`;
}

export function extractTicketId(subject: string | null | undefined): number | null {
  if (!subject) return null;
  const match = subject.match(TICKET_TAG_REGEX);
  if (!match) return null;
  const id = Number.parseInt(match[1] ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

export function ensureTag(subject: string, ticketId: number): string {
  if (TICKET_TAG_REGEX.test(subject)) return subject;
  return `${subject} ${buildTicketTag(ticketId)}`;
}
