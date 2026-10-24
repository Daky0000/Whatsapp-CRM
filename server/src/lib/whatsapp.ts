import { config } from "../config.js";
import { hmacHex, safeEqualHex } from "./crypto.js";
import { HttpError } from "./errors.js";

/**
 * Meta's WhatsApp Cloud API. Talks to Meta and nothing else: no database and
 * no policy. Whether a message *should* go (the 24-hour window, opt-outs,
 * plan limits) is decided in services/sender.ts.
 *
 * The rule that shapes everything: a business may send free-form text only
 * within 24 hours of the customer's last message. Outside that window, only a
 * template Meta approved in advance can be sent.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const graphBase = () => `https://graph.facebook.com/${config.meta.graphVersion}`;

export class WhatsAppError extends HttpError {
  constructor(message: string, status = 502, readonly metaCode: number | null = null) {
    super(status, message, metaCode ? `meta_${metaCode}` : undefined);
    this.name = "WhatsAppError";
  }
}

/** Meta's error codes in words a seller can act on. */
export function explain(code: number | null, fallback: string): string {
  switch (code) {
    case 131047:
      return "More than 24 hours have passed since this customer last messaged you, so WhatsApp only allows an approved template now.";
    case 131026:
      return "WhatsApp couldn't deliver this message. The number may not be on WhatsApp.";
    case 132000:
    case 132001:
      return "That template doesn't exist in this language, or isn't approved yet.";
    case 131049:
      return "WhatsApp held back this marketing message to protect the customer's experience. Try again in a day or two.";
    case 131056:
      return "Too many messages to this customer in a short time. Wait a little and try again.";
    case 190:
      return "Your WhatsApp connection has expired. Reconnect WhatsApp in Settings.";
    case 131031:
      return "This WhatsApp Business account is locked by Meta. Check Meta Business Suite.";
    default:
      return fallback;
  }
}

async function graph<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${graphBase()}${path}`, {
      method: init.method ?? "GET",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new WhatsAppError("WhatsApp could not be reached. Please try again.", 503);
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: { code?: number; message?: string } }) | null;
  if (!response.ok || !payload || payload.error) {
    const code = payload?.error?.code ?? null;
    throw new WhatsAppError(explain(code, payload?.error?.message ?? `WhatsApp answered ${response.status}.`), response.status >= 500 ? 502 : 400, code);
  }
  return payload;
}

/** X-Hub-Signature-256: "sha256=<hex>" over the raw request bytes, keyed by the app secret. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret = config.meta.appSecret): boolean {
  if (!appSecret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  return safeEqualHex(hmacHex("sha256", appSecret, rawBody), header.slice("sha256=".length));
}

interface SendResult {
  messages?: Array<{ id: string }>;
}

export async function sendText(token: string, phoneNumberId: string, to: string, body: string): Promise<string> {
  const data = await graph<SendResult>(token, `/${phoneNumberId}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: true } },
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the message but returned no id.");
  return id;
}

export async function sendTemplate(
  token: string,
  phoneNumberId: string,
  to: string,
  template: { name: string; language: string; bodyParams: string[] },
): Promise<string> {
  const components = template.bodyParams.length
    ? [{ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text })) }]
    : [];
  const data = await graph<SendResult>(token, `/${phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: template.name, language: { code: template.language }, components },
    },
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the template but returned no id.");
  return id;
}

export interface TemplateSummary {
  name: string;
  language: string;
  status: string;
  category: string;
  body: string;
  variableCount: number;
}

export async function listTemplates(token: string, wabaId: string): Promise<TemplateSummary[]> {
  const data = await graph<{
    data: Array<{ name: string; language: string; status: string; category: string; components?: Array<{ type: string; text?: string }> }>;
  }>(token, `/${wabaId}/message_templates?limit=200&fields=name,language,status,category,components`);
  return data.data.map((t) => {
    const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
    return {
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      body,
      variableCount: new Set(body.match(/\{\{\d+\}\}/g) ?? []).size,
    };
  });
}

export async function phoneNumberInfo(token: string, phoneNumberId: string) {
  return graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    token,
    `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
  );
}

/**
 * Embedded Signup returns a short-lived code to the browser. Exchanged here,
 * server-side, for the business integration token, because the app secret
 * must never reach the browser.
 */
export async function exchangeSignupCode(code: string): Promise<string> {
  const { appId, appSecret } = config.meta;
  if (!appId || !appSecret) throw new WhatsAppError("WhatsApp signup isn't configured on the server yet.", 503);
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const payload = (await response.json().catch(() => null)) as { access_token?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.access_token) {
    throw new WhatsAppError(payload?.error?.message ?? "Meta refused the signup code. Please try connecting again.", 400);
  }
  return payload.access_token;
}

/** Without this, Meta sends the WABA's webhooks to nobody. */
export async function subscribeApp(token: string, wabaId: string): Promise<void> {
  await graph(token, `/${wabaId}/subscribed_apps`, { method: "POST" });
}

/**
 * Coexistence: asks Meta to send the WhatsApp Business app's contacts and
 * recent 1:1 history to our webhook (fields `smb_app_state_sync` and
 * `history`). Meta allows this once, shortly after onboarding.
 */
export async function requestCoexistenceSync(token: string, phoneNumberId: string): Promise<void> {
  for (const sync_type of ["smb_app_state_sync", "history"]) {
    await graph(token, `/${phoneNumberId}/smb_app_data`, { method: "POST", body: { messaging_product: "whatsapp", sync_type } });
  }
}

/** Media ids from webhooks resolve to a short-lived URL that also needs the token. */
export async function downloadMedia(token: string, mediaId: string): Promise<{ contentType: string; body: ArrayBuffer }> {
  const meta = await graph<{ url: string; mime_type: string }>(token, `/${mediaId}`);
  const response = await fetch(meta.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new WhatsAppError("Couldn't download that media from WhatsApp.");
  return { contentType: meta.mime_type, body: await response.arrayBuffer() };
}
