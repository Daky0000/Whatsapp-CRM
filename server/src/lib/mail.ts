import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email, configured with exactly the variables DakyXTech OS uses
 * (server/src/lib/mailer.ts and hostingerMail.ts in the dakyworld repo), so
 * one set of values in Railway serves both services:
 *
 *   MAIL_TRANSPORT            SMTP | HOSTINGER (unset: whichever is configured, SMTP first)
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD
 *   HOSTINGER_MAIL_TOKEN, HOSTINGER_MAILBOX_ID, HOSTINGER_MAILBOX_ADDRESS
 *   MAIL_FROM_NAME, MAIL_FROM_EMAIL, MAIL_REPLY_TO
 *
 * The OS reads environment variables before its own settings table, so
 * moving these into Railway shared variables keeps the OS working unchanged.
 *
 * For Hostinger this uses the documented Mail API, which the OS also falls
 * back to; it doesn't need the OS's MCP client for one-way notices.
 * Unconfigured, sending is skipped and callers carry on.
 */

const env = (name: string) => process.env[name]?.trim() || null;

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

function smtpConfig(): SmtpConfig | null {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const password = env("SMTP_PASSWORD");
  if (!host || !user || !password || !env("MAIL_FROM_EMAIL")) return null;
  const port = Number(env("SMTP_PORT") ?? 587) || 587;
  const secure = env("SMTP_SECURE");
  // 465 is implicit TLS, 587 STARTTLS; follow the port unless set explicitly, as the OS does.
  return { host, port, secure: secure === null ? port === 465 : secure === "true", user, password };
}

function hostingerConfig() {
  const token = env("HOSTINGER_MAIL_TOKEN");
  const mailboxId = env("HOSTINGER_MAILBOX_ID");
  const address = env("HOSTINGER_MAILBOX_ADDRESS");
  return token && mailboxId && address ? { token, mailboxId, address } : null;
}

export type MailTransport = "SMTP" | "HOSTINGER";

export function activeTransport(): MailTransport | null {
  const chosen = env("MAIL_TRANSPORT")?.toUpperCase();
  if (chosen === "SMTP") return smtpConfig() ? "SMTP" : null;
  if (chosen === "HOSTINGER") return hostingerConfig() ? "HOSTINGER" : null;
  return smtpConfig() ? "SMTP" : hostingerConfig() ? "HOSTINGER" : null;
}

export function mailConfigured(): boolean {
  return activeTransport() !== null;
}

let cached: { key: string; transport: Transporter } | null = null;

function smtpTransport(c: SmtpConfig): Transporter {
  const key = `${c.host}:${c.port}:${c.secure}:${c.user}:${c.password}`;
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        auth: { user: c.user, pass: c.password },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      }),
    };
  }
  return cached.transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one message. Returns false when no mail transport is configured. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const transport = activeTransport();
  if (!transport) return false;
  const fromName = env("MAIL_FROM_NAME") ?? "DakyX";

  if (transport === "SMTP") {
    const replyTo = env("MAIL_REPLY_TO");
    await smtpTransport(smtpConfig()!).sendMail({
      from: { name: fromName, address: env("MAIL_FROM_EMAIL")! },
      ...(replyTo ? { replyTo } : {}),
      ...mail,
    });
    return true;
  }

  const h = hostingerConfig()!;
  const base = (env("HOSTINGER_MAIL_API") ?? "https://api.mail.hostinger.com").replace(/\/$/, "");
  const response = await fetch(`${base}/api/v1/mailboxes/${encodeURIComponent(h.mailboxId)}/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${h.token}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, displayName: fromName }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Hostinger Mail answered ${response.status}${body?.message ? `: ${body.message}` : ""}`);
  }
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
