import { beforeEach, describe, expect, it, vi } from "vitest";

// Haertungsluecke: sendAndLogEmail() (src/lib/outbound.ts) hat
// `send: typeof sendSmtp = sendSmtp` als Default-Parameter, aber JEDER
// bestehende Test injiziert einen Fake dafuer -> der Default (und damit
// sendSmtp selbst) lief in keinem Test je durch. Ein Fehler im echten
// nodemailer-Aufruf (falscher Feldname, falsche secure-Logik, kaputtes
// inReplyTo-Handling) waere niemandem aufgefallen.
//
// Dieser Test mockt NUR nodemailer (vi.mock) und laesst sendSmtp selbst echt
// laufen -> es wird verifiziert, was tatsaechlich an nodemailer.createTransport
// und transport.sendMail uebergeben wird. Es wird keine echte Verbindung
// aufgebaut und keine echte Mail versendet.

const { createTransportMock, sendMailMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: "fake" });
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { createTransportMock, sendMailMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { sendSmtp } from "@/channel/smtp";

describe("sendSmtp (echter nodemailer-Aufruf, nodemailer selbst gemockt)", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.MAIL_USER = "login@example.com";
    process.env.MAIL_PASSWORD = "app-passwort";
    process.env.MAIL_ALIAS = "hausverwaltung@example.com";
    process.env.DASHBOARD_PASSWORD = "test";
    process.env.SMTP_HOST = "smtp.fastmail.com";
    delete process.env.SMTP_PORT;

    createTransportMock.mockClear();
    sendMailMock.mockClear();
  });

  it("baut den Transport mit Host, Port und Zugangsdaten aus getEnv(); Port 465 -> secure=true", async () => {
    process.env.SMTP_PORT = "465";

    await sendSmtp({ to: "max@example.com", subject: "Test", text: "Hallo" });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.fastmail.com",
      port: 465,
      secure: true,
      auth: { user: "login@example.com", pass: "app-passwort" },
    });
  });

  it("Port 587 (nicht 465) -> secure=false", async () => {
    process.env.SMTP_PORT = "587";

    await sendSmtp({ to: "max@example.com", subject: "Test", text: "Hallo" });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("sendMail bekommt from=MAIL_ALIAS sowie to/subject/text aus dem Parameter; ohne inReplyTo bleibt kein leerer Wert übrig", async () => {
    process.env.SMTP_PORT = "465";

    await sendSmtp({ to: "max@example.com", subject: "Türschloss defekt", text: "Wir kümmern uns darum." });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0]![0];
    expect(arg).toEqual({
      from: "hausverwaltung@example.com",
      to: "max@example.com",
      subject: "Türschloss defekt",
      text: "Wir kümmern uns darum.",
    });
    expect(arg).not.toHaveProperty("inReplyTo");
    expect(arg).not.toHaveProperty("references");
  });

  it("gesetztes inReplyTo landet als inReplyTo UND references im sendMail-Aufruf", async () => {
    process.env.SMTP_PORT = "465";

    await sendSmtp({
      to: "max@example.com",
      subject: "Re: Türschloss defekt",
      text: "Antwort auf Ihre Anfrage.",
      inReplyTo: "<anfrage-123@example.com>",
    });

    const arg = sendMailMock.mock.calls[0]![0];
    expect(arg.inReplyTo).toBe("<anfrage-123@example.com>");
    expect(arg.references).toBe("<anfrage-123@example.com>");
  });
});
