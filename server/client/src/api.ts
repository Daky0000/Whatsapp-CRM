export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.code);
  return data as T;
}

export const ghs = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "—" : `GHS ${Number(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function displayPhone(e164: string) {
  return e164.startsWith("233") && e164.length === 12 ? `+233 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}` : `+${e164}`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export type Category = "UNSORTED" | "NEW_LEAD" | "ORDER" | "INQUIRY" | "COMPLAINT" | "FOLLOW_UP" | "NOT_BUSINESS";
export const CATEGORY_LABEL: Record<Category, string> = {
  UNSORTED: "Not sorted yet",
  NEW_LEAD: "New lead",
  ORDER: "Order",
  INQUIRY: "Inquiry",
  COMPLAINT: "Complaint",
  FOLLOW_UP: "Follow up",
  NOT_BUSINESS: "Not business",
};
export const CATEGORY_STYLE: Record<Category, string> = {
  UNSORTED: "bg-slate-100 text-slate-600",
  NEW_LEAD: "bg-sky-100 text-sky-800",
  ORDER: "bg-emerald-100 text-emerald-800",
  INQUIRY: "bg-violet-100 text-violet-800",
  COMPLAINT: "bg-red-100 text-red-800",
  FOLLOW_UP: "bg-amber-100 text-amber-800",
  NOT_BUSINESS: "bg-slate-100 text-slate-500",
};
export const STAGES = ["NEW", "NEGOTIATING", "ORDERED", "PAID", "DELIVERED", "LOST"] as const;
export type Stage = (typeof STAGES)[number];

export interface Me {
  user: { id: string; email: string; name: string; role: "OWNER" | "AGENT" };
  workspace: {
    id: string;
    name: string;
    plan: "STARTER" | "PRO";
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED";
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    walletGhs: number;
    businessDescription: string | null;
    brandVoice: string;
    replyLanguage: string;
    hoursOpen: string;
    hoursClose: string;
    dailySummaryEmail: boolean;
  };
  billing: { active: boolean; limits: Record<string, number | boolean | null | string>; usage: { triage: number; drafts: number } };
  connection: { mode: "CLOUD" | "IMPORT"; displayPhone: string | null; verifiedName: string | null; coexistence: boolean; historySyncedAt: string | null } | null;
}
