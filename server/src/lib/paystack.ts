import { hmacHex, safeEqualHex } from "./crypto.js";
import { HttpError } from "./errors.js";

/**
 * Paystack, configured exactly like DakyXTech OS (server/src/lib/paystack.ts in
 * the dakyworld repo): the same two secret-key slots, sorted by their prefix
 * rather than by which slot they sit in, and the same PAYSTACK_MODE switch.
 * Here they come from the environment instead of the OS's settings table, so
 * the Railway service can be given the same values as the OS.
 *
 * **Amounts are in pesewas.** Paystack always takes the minor unit, and the
 * mistake is silent: GHS 50 sent as 50 charges GHS 0.50. Every crossing goes
 * through `toPesewas` here.
 */
const BASE = "https://api.paystack.co";

export type PaystackMode = "live" | "test";

export function paystackKeys(): Record<PaystackMode, string | null> {
  const stored = [process.env.PAYSTACK_SECRET_KEY, process.env.PAYSTACK_TEST_SECRET_KEY];
  const pick = (mode: PaystackMode) => stored.find((key) => key?.startsWith(`sk_${mode}_`)) ?? null;
  return { live: pick("live"), test: pick("test") };
}

export function paystackMode(): PaystackMode | null {
  const keys = paystackKeys();
  const chosen = process.env.PAYSTACK_MODE?.trim().toLowerCase();
  if ((chosen === "live" || chosen === "test") && keys[chosen]) return chosen;
  return keys.live ? "live" : keys.test ? "test" : null;
}

export function paystackConfigured(): boolean {
  return paystackMode() !== null;
}

function secretKey(): string {
  const mode = paystackMode();
  const key = mode ? paystackKeys()[mode] : null;
  if (!key) throw new HttpError(503, "Payments aren't set up yet. Please try again later.");
  return key;
}

export function toPesewas(ghs: number): number {
  const minor = Math.round(ghs * 100);
  if (!Number.isFinite(ghs) || minor <= 0 || Math.abs(ghs * 100 - minor) > 0.00001) {
    throw new HttpError(400, "Enter a positive amount with at most two decimal places.");
  }
  return minor;
}

interface Envelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
      headers: { authorization: `Bearer ${secretKey()}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, "Paystack could not be reached. Check your payment status before trying again.");
  }
  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new HttpError(502, `Paystack answered ${response.status} with something that wasn't JSON.`);
  }
  if (!response.ok || !payload?.status) {
    throw new HttpError(502, "Paystack could not complete this request. Please try again shortly.");
  }
  return payload.data;
}

export async function initializeTransaction(input: {
  email: string;
  amountPesewas: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
  /** A Paystack plan code: Paystack then creates a renewing subscription after the first card charge. */
  plan?: string;
}): Promise<{ url: string; reference: string }> {
  const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: {
      email: input.email,
      amount: input.amountPesewas,
      currency: "GHS",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
      ...(input.plan ? { plan: input.plan } : {}),
    },
  });
  if (data?.reference !== input.reference || !isPaystackUrl(data.authorization_url)) {
    throw new HttpError(502, "Paystack returned an invalid checkout.");
  }
  return { url: data.authorization_url, reference: data.reference };
}

export function isPaystackUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && ["checkout.paystack.com", "paystack.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export interface VerifiedTransaction {
  reference: string;
  paid: boolean;
  /** Paystack's own word: success, failed, abandoned, ongoing, pending, reversed. */
  status: string;
  amountPesewas: number;
  currency: string;
  channel: string | null;
  paidAt: Date | null;
  customerEmail: string | null;
  customerCode: string | null;
}

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const data = await call<{
    reference: string;
    status: string;
    amount: number;
    currency: string;
    channel: string | null;
    paid_at: string | null;
    domain: string;
    customer?: { email?: string; customer_code?: string };
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (data?.reference !== reference || !Number.isSafeInteger(data.amount)) {
    throw new HttpError(502, "Paystack returned an invalid verification.");
  }
  // A test payment must never activate a live workspace.
  if (data.domain !== paystackMode()) throw new HttpError(409, "Payment mode does not match.");
  return {
    reference: data.reference,
    paid: data.status === "success",
    status: data.status,
    amountPesewas: data.amount,
    currency: data.currency,
    channel: data.channel ?? null,
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    customerEmail: data.customer?.email ?? null,
    customerCode: data.customer?.customer_code ?? null,
  };
}

export async function createPlan(name: string, amountPesewas: number, interval: "monthly" | "annually"): Promise<string> {
  const data = await call<{ plan_code: string }>("/plan", {
    method: "POST",
    body: { name, amount: amountPesewas, interval, currency: "GHS" },
  });
  if (!data?.plan_code?.startsWith("PLN_")) throw new HttpError(502, "Paystack returned an invalid plan.");
  return data.plan_code;
}

export async function disableSubscription(code: string): Promise<void> {
  const sub = await call<{ email_token: string; status: string }>(`/subscription/${encodeURIComponent(code)}`);
  if (["cancelled", "complete", "completed", "non-renewing"].includes(sub.status)) return;
  await call("/subscription/disable", { method: "POST", body: { code, token: sub.email_token } });
}

/**
 * HMAC-SHA512 over the exact bytes Paystack sent, keyed by the active secret
 * key (Paystack has no separate webhook secret). The route must see the raw
 * body: a re-serialised JSON body fails the check.
 */
export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const mode = paystackMode();
  const key = mode ? paystackKeys()[mode] : null;
  if (!key) return false;
  return safeEqualHex(hmacHex("sha512", key, rawBody), signature);
}
