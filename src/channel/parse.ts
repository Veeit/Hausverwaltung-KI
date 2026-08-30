import { simpleParser, type AddressObject } from "mailparser";
import type { IncomingAttachment, IncomingEmail } from "@/channel/types";

function collectAddresses(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  const addresses: string[] = [];
  for (const obj of objects) {
    for (const entry of obj.value) {
      if (entry.address) addresses.push(entry.address.toLowerCase());
    }
  }
  return addresses;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseRawEmail(source: Buffer): Promise<IncomingEmail> {
  const parsed = await simpleParser(source);

  let text = (parsed.text ?? "").trim();
  if (!text && parsed.html) {
    text = stripHtmlTags(parsed.html);
  }

  const attachments: IncomingAttachment[] = (parsed.attachments ?? []).map((attachment) => ({
    filename: attachment.filename ?? "unbenannt.bin",
    mimeType: attachment.contentType,
    content: attachment.content,
  }));

  return {
    messageId: parsed.messageId ?? `generated-${Date.now()}-${Math.random()}`,
    from: collectAddresses(parsed.from)[0] ?? "",
    to: [...collectAddresses(parsed.to), ...collectAddresses(parsed.cc)],
    subject: parsed.subject ?? "",
    text,
    date: parsed.date ?? new Date(),
    attachments,
  };
}
