import nodemailer from "nodemailer";
import { getEnv } from "@/env";
import type { OutgoingEmail } from "@/channel/types";

export async function sendSmtp(mail: OutgoingEmail): Promise<void> {
  const env = getEnv();
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD },
  });
  await transport.sendMail({
    from: env.MAIL_ALIAS,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.inReplyTo } : {}),
  });
}
