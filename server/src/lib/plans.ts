import type { PlanId, SubscriptionStatus } from "@prisma/client";

/**
 * The two plans. Every limit the app enforces is read from here, so changing a
 * number is a one-line change. `Infinity` means no limit.
 *
 * Meta's per-message fees for broadcasts are NOT covered by either plan: they
 * come out of the message wallet (see services/wallet.ts). The plan limits on
 * broadcast recipients are there to protect the seller's number from a
 * quality-rating drop, not to cover cost.
 */
export interface PlanLimits {
  priceGhs: number;
  seats: number;
  historyDays: number;
  historyChats: number;
  aiTriagePerMonth: number;
  aiDraftsPerMonth: number;
  contacts: number;
  lists: number;
  broadcastRecipientsPerMonth: number;
  freeBroadcastCredits: number;
  autoReplyRules: number;
  products: number;
  scheduledBroadcasts: boolean;
  followUps: boolean;
  orderPipeline: boolean;
  analyticsExport: boolean;
}

export const PLANS: Record<PlanId, PlanLimits & { name: string }> = {
  STARTER: {
    name: "Starter",
    priceGhs: 50,
    seats: 1,
    historyDays: 30,
    historyChats: 200,
    aiTriagePerMonth: 300,
    aiDraftsPerMonth: 150,
    contacts: 500,
    lists: 2,
    broadcastRecipientsPerMonth: 200,
    freeBroadcastCredits: 50,
    autoReplyRules: 3,
    products: 20,
    scheduledBroadcasts: false,
    followUps: false,
    orderPipeline: false,
    analyticsExport: false,
  },
  PRO: {
    name: "Pro",
    priceGhs: 150,
    seats: 3,
    historyDays: 183,
    historyChats: 2000,
    aiTriagePerMonth: 3000,
    aiDraftsPerMonth: 2000,
    contacts: 10_000,
    lists: Infinity,
    broadcastRecipientsPerMonth: 5000,
    freeBroadcastCredits: 300,
    autoReplyRules: Infinity,
    products: Infinity,
    scheduledBroadcasts: true,
    followUps: true,
    orderPipeline: true,
    analyticsExport: true,
  },
};

export const TRIAL_DAYS = 7;
/** Annual billing charges ten months for twelve. */
export const ANNUAL_MONTHS_CHARGED = 10;

export function priceFor(plan: PlanId, months: 1 | 12): number {
  return PLANS[plan].priceGhs * (months === 12 ? ANNUAL_MONTHS_CHARGED : 1);
}

/** Usage counters are per calendar month in Accra time (UTC+0). */
export function period(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export interface WorkspaceBilling {
  plan: PlanId;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Whether the workspace may use paid features right now. A lapsed workspace
 * keeps its data readable, but cannot send, broadcast or spend AI. A short
 * grace period covers a renewal that is a day late on MoMo.
 */
export function isActive(w: WorkspaceBilling, now = new Date()): boolean {
  const GRACE_MS = 3 * 86_400_000;
  if (w.status === "TRIALING") return !!w.trialEndsAt && w.trialEndsAt > now;
  if (w.status === "ACTIVE" || w.status === "PAST_DUE") {
    return !!w.currentPeriodEnd && w.currentPeriodEnd.getTime() + GRACE_MS > now.getTime();
  }
  return false;
}

/** The limits in force. A trial gets Pro, so sellers see everything before choosing. */
export function limitsFor(w: WorkspaceBilling): PlanLimits {
  return w.status === "TRIALING" ? PLANS.PRO : PLANS[w.plan];
}
