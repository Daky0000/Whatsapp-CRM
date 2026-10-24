import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email over SMTP. SMTP_URL is e.g.
 * smtps://user:pass@smtp.hostinger.com:465 (the same mailbox host as dakyx.com).
 * Unset, email is simply skipped, so nothing else depends on it.
 */
let transport: Transporter | undefined;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

export async function sendMail(input: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  if (!process.env.SMTP_URL) return false;
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM ?? "DakyX WhatsApp CRM <no-reply@dakyx.com>", ...input });
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
