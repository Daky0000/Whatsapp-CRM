import { prisma } from "../db.js";
import { isActive, limitsFor } from "../lib/plans.js";
import { applyPayment, expireLapsed } from "./billing.js";
import { sendBroadcast } from "./broadcasts.js";
import { triageConversation } from "./triage.js";
import { reconcileOrderPayments } from "./payLinks.js";
import { sendDailySummaries } from "./dailySummary.js";

/**
 * In-process timers. One server instance is assumed (Railway, one replica);
 * every job claims its rows with a conditional update, so a second instance
 * would do no double work, only wasted queries.
 */
export function startScheduler() {
  const every = (ms: number, name: string, job: () => Promise<unknown>) =>
    setInterval(() => job().catch((err) => console.error(`[scheduler] ${name}`, err)), ms).unref();

  every(60_000, "broadcasts", runDueBroadcasts);
  every(10 * 60_000, "billing", async () => {
    await reconcilePendingPayments();
    await reconcileOrderPayments();
    await expireLapsed();
  });
  every(60 * 60_000, "follow-ups", queueFollowUps);
  every(60 * 60_000, "daily-summary", () => sendDailySummaries());
}

/**
 * Paystack sends webhooks to one URL per account, and this account's URL
 * belongs to DakyXTech OS. Until the OS forwards our events, a payment whose
 * buyer closed the tab before returning would never be applied, so pending
 * payments from the last day are re-checked with Paystack here.
 */
async function reconcilePendingPayments() {
  const pending = await prisma.payment.findMany({
    where: { status: "PENDING", createdAt: { gte: new Date(Date.now() - 86_400_000), lte: new Date(Date.now() - 5 * 60_000) } },
    select: { reference: true },
    take: 50,
  });
  for (const p of pending) {
    await applyPayment(p.reference).catch((err) => console.warn(`[billing] reconcile ${p.reference}: ${(err as Error).message}`));
  }
}

async function runDueBroadcasts() {
  const due = await prisma.broadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true, workspaceId: true },
    take: 20,
  });
  for (const b of due) {
    await sendBroadcast(b.workspaceId, b.id).catch((err) => console.warn(`[broadcast] ${b.id}: ${(err as Error).message}`));
  }
}

/**
 * The customer asked, the seller answered, and the customer went quiet. A
 * nudge has to go out while the 24-hour window is still open (after that only
 * a paid template can reach them), so we look for chats whose last customer
 * message was 18 to 23 hours ago and whose last word was the seller's.
 */
export async function queueFollowUps(now = new Date()) {
  const hour = 3_600_000;
  const candidates = await prisma.conversation.findMany({
    where: {
      lastInboundAt: { gte: new Date(now.getTime() - 23 * hour), lte: new Date(now.getTime() - 18 * hour) },
      category: { in: ["NEW_LEAD", "INQUIRY", "ORDER"] },
      stage: { in: ["NEW", "NEGOTIATING"] },
      drafts: { none: { kind: "FOLLOW_UP", createdAt: { gte: new Date(now.getTime() - 7 * 24 * hour) } } },
    },
    include: {
      workspace: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } },
      messages: { orderBy: { timestamp: "desc" }, take: 1, select: { direction: true } },
    },
    take: 200,
  });
  for (const c of candidates) {
    if (!isActive(c.workspace) || !limitsFor(c.workspace).followUps) continue;
    if (c.messages[0]?.direction !== "OUTBOUND") continue;
    await triageConversation(c.id, { followUp: true }).catch((err) => console.warn(`[follow-up] ${c.id}: ${(err as Error).message}`));
  }
}
