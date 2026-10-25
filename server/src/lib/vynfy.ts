import { normalizePhone } from "./phone.js";

/**
 * Vynfy, the Ghanaian SMS/OTP gateway, configured as in the laluxury repo
 * (src/lib/sms.ts, nobleenclave.com): VYNFY_API_KEY and VYNFY_SENDER_ID.
 *
 * `/otp/generate` and `/otp/verify` hold the code themselves: Vynfy makes it,
 * delivers it by SMS or a voice call, counts three attempts and expires it.
 * We never see the code, so there is nothing of ours to leak or go stale.
 * Vynfy has no WhatsApp delivery; that channel is services/otp.ts using the
 * OS's own WhatsApp number.
 *
 * Reference: https://sms.vynfy.com/api/v1/docs
 */
const baseUrl = () => (process.env.VYNFY_BASE_URL?.trim() || "https://sms.vynfy.com").replace(/\/$/, "");

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
/** The default "USSD fallback" Vynfy returns: a customer whose SMS is late can dial it to see the code. */
const DEFAULT_USSD = "*928*01#";

export type VynfyResult =
  | { ok: true; pending?: boolean; ussdCode?: string }
  | { ok: false; code: string; message: string; fatal: boolean };

/**
 * Failures where retrying unchanged is pointless. Everything else is "we don't
 * know": Vynfy has been seen to send the code and then fail its own response,
 * so an unhappy reply must not strand someone holding a code (laluxury's lesson).
 */
const FATAL = new Set([
  "NOT_CONFIGURED", "SENDER_ID_NOT_APPROVED", "UNAUTHORISED", "INVALID_PHONE", "MISSING_PHONE", "EMPTY_PHONE",
  "INSUFFICIENT_BALANCE", "EMPTY_MESSAGE", "INVALID_MESSAGE", "MESSAGE_TOO_LONG", "EMPTY_SENDER_ID",
  "SENDER_ID_TOO_LONG", "INVALID_LENGTH", "INVALID_EXPIRY", "INVALID_MEDIUM", "INVALID_OTP_TYPE",
]);

function credentials() {
  const apiKey = process.env.VYNFY_API_KEY?.trim();
  if (!apiKey) return null;
  // Must exactly match a sender ID Vynfy approved for the account (max 11 characters).
  return { apiKey, senderId: (process.env.VYNFY_SENDER_ID?.trim() || "DakyXTech").slice(0, 11) };
}

export const vynfyConfigured = () => credentials() !== null;

/** Vynfy accepts 233XXXXXXXXX for Ghana; anything else goes as "+" and the digits. */
function forGateway(e164: string) {
  return e164.startsWith("233") ? e164 : `+${e164}`;
}

interface VynfyResponse {
  success?: boolean;
  message?: string;
  error?: string;
  error_code?: string;
  ussd_code?: string;
  attempts_remaining?: number;
}

/** sms.vynfy.com sits behind Cloudflare: a challenge page is HTML, so read text first and parse after. */
async function call(path: string, apiKey: string, body: Record<string, unknown>): Promise<{ status: number; data: VynfyResponse }> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // A named agent is something Vynfy can allowlist; an empty one is cheap for an edge to block.
        "user-agent": "DakyX-WhatsAppCRM/1.0 (+https://whatsappcrm.dakyx.com)",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    text = await response.text();
  } catch (err) {
    console.error(`[vynfy] ${path} did not complete: ${(err as Error).message}`);
    return { status: 0, data: {} };
  }
  try {
    return { status: response.status, data: JSON.parse(text) as VynfyResponse };
  } catch {
    console.error(`[vynfy] ${path} returned ${response.status} ${response.headers.get("content-type") ?? "?"} (not JSON)`);
    return { status: response.status, data: {} };
  }
}

function readable(path: string, status: number, data: VynfyResponse): { code: string; message: string; fatal: boolean } {
  const providerText = String(data.message ?? data.error ?? "");
  const code = /sender\s*id/i.test(providerText) ? "SENDER_ID_NOT_APPROVED" : status === 401 ? "UNAUTHORISED" : data.error_code ?? data.error ?? `HTTP_${status}`;
  // Vynfy's own words go to our log with long digit runs masked, never to the customer.
  console.error(`[vynfy] ${path} failed: status=${status} code=${JSON.stringify(code)} provider=${JSON.stringify(providerText.replace(/\d{6,}/g, "<number>").slice(0, 200))}`);
  const messages: Record<string, string> = {
    UNAUTHORISED: "Our SMS account needs attention, so we couldn't send a code just now. Please contact DakyX support.",
    SENDER_ID_NOT_APPROVED: "Our SMS sender name isn't approved yet, so codes can't go out. Please contact DakyX support.",
    INVALID_PHONE: "Our SMS network wouldn't accept that number. Codes reach Ghanaian networks reliably.",
    MISSING_PHONE: "Enter your phone number.",
    INSUFFICIENT_BALANCE: "We couldn't send the code just now. Please try again shortly.",
    NO_OTP_FOUND: "That code has expired. Ask for a new one.",
    OTP_EXPIRED: "That code has expired. Ask for a new one.",
    INVALID_OTP: "That code isn't right. Check the message and try again.",
    EMPTY_CODE: "Enter the code we sent you.",
  };
  return {
    code,
    fatal: FATAL.has(code),
    message: messages[code] ?? `The SMS network had trouble with that. If the code doesn't arrive, ask for another (SMS-${status || "NET"}).`,
  };
}

/** Generates a code and delivers it by SMS or voice call. The code is never returned to us. */
export async function vynfySendOtp(phone: string, medium: "sms" | "voice"): Promise<VynfyResult> {
  const number = normalizePhone(phone);
  if (!number) return { ok: false, code: "INVALID_PHONE", fatal: true, message: "Enter a valid phone number, e.g. 024 123 4567." };
  const creds = credentials();
  if (!creds) return { ok: false, code: "NOT_CONFIGURED", fatal: true, message: "Phone verification isn't switched on yet." };

  // `%otp_code%` is required, and the whole message must fit 160 characters.
  const message = `DakyXTech WhatsApp CRM: your code is %otp_code%. It expires in ${OTP_EXPIRY_MINUTES} minutes. Don't share it with anyone.`;
  const payload = {
    number: forGateway(number),
    message: message.slice(0, 160),
    sender_id: creds.senderId,
    otp_type: "numeric",
    medium,
    length: OTP_LENGTH,
    expiry: OTP_EXPIRY_MINUTES,
  };

  let status = 0;
  let data: VynfyResponse = {};
  for (const delay of [0, 800, 1500]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    ({ status, data } = await call("/otp/generate", creds.apiKey, payload));
    if (status === 200 && data.success) return { ok: true, ussdCode: data.ussd_code || DEFAULT_USSD };
    const code = data.error_code ?? data.error ?? "";
    // A code is already on its way: that's success from the customer's side.
    if (status === 429 || code === "OTP_PENDING") return { ok: true, pending: true, ussdCode: data.ussd_code || DEFAULT_USSD };
    if (FATAL.has(code) || status === 401) break;
  }
  return { ok: false, ...readable("/otp/generate", status, data) };
}

export async function vynfyVerifyOtp(phone: string, code: string): Promise<VynfyResult> {
  const number = normalizePhone(phone);
  if (!number) return { ok: false, code: "INVALID_PHONE", fatal: true, message: "Enter a valid phone number." };
  const creds = credentials();
  if (!creds) return { ok: false, code: "NOT_CONFIGURED", fatal: true, message: "Phone verification isn't switched on yet." };
  const { status, data } = await call("/otp/verify", creds.apiKey, { number: forGateway(number), code: code.trim() });
  if (status === 200 && data.success) return { ok: true };
  const error = readable("/otp/verify", status, data);
  if (error.code === "INVALID_OTP" && typeof data.attempts_remaining === "number") {
    const left = data.attempts_remaining;
    error.message = `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left before you need a new one.`;
  }
  return { ok: false, ...error };
}

/** A plain text (650 characters max). Returned, never thrown: a text that fails must not fail its caller. */
export async function vynfySendSms(phone: string, message: string): Promise<VynfyResult> {
  const number = normalizePhone(phone);
  const creds = credentials();
  if (!number || !creds) return { ok: false, code: number ? "NOT_CONFIGURED" : "INVALID_PHONE", fatal: true, message: "SMS not sent." };
  const clean = message.replace(/₵/g, "GHS ").replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").slice(0, 650);
  const { status, data } = await call("/api/v1/send", creds.apiKey, { sender: creds.senderId, recipients: [forGateway(number)], message: clean });
  if (status >= 200 && status < 300 && data.success !== false) return { ok: true };
  return { ok: false, ...readable("/api/v1/send", status, data) };
}
