import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { isActive, limitsFor, period, type PlanLimits } from "../lib/plans.js";

export async function billingOf(workspaceId: string) {
  const w = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  return { ...w, active: isActive(w), limits: limitsFor(w) };
}

/** Throws 402 when the subscription has lapsed. Reading data is always allowed; this guards spending. */
export async function assertActive(workspaceId: string): Promise<PlanLimits> {
  const b = await billingOf(workspaceId);
  if (!b.active) throw new HttpError(402, "Your subscription has ended. Renew under Billing to keep sending and using AI.", "inactive");
  return b.limits;
}

export async function usageCount(workspaceId: string, metric: string): Promise<number> {
  const row = await prisma.usageCounter.findUnique({
    where: { workspaceId_metric_period: { workspaceId, metric, period: period() } },
  });
  return row?.count ?? 0;
}

/**
 * Atomically adds `amount` to this month's counter, refusing (and changing
 * nothing) when that would pass `limit`. The conditional UPDATE is what makes
 * two simultaneous requests unable to both squeeze under the limit.
 */
export async function consume(workspaceId: string, metric: string, limit: number, amount = 1): Promise<boolean> {
  if (limit === Infinity) {
    await prisma.usageCounter.upsert({
      where: { workspaceId_metric_period: { workspaceId, metric, period: period() } },
      create: { workspaceId, metric, period: period(), count: amount },
      update: { count: { increment: amount } },
    });
    return true;
  }
  const p = period();
  await prisma.usageCounter.upsert({
    where: { workspaceId_metric_period: { workspaceId, metric, period: p } },
    create: { workspaceId, metric, period: p, count: 0 },
    update: {},
  });
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "UsageCounter" SET "count" = "count" + ${amount}
    WHERE "workspaceId" = ${workspaceId} AND "metric" = ${metric} AND "period" = ${p} AND "count" + ${amount} <= ${limit}`);
  return updated === 1;
}

export async function release(workspaceId: string, metric: string, amount = 1): Promise<void> {
  await prisma.usageCounter.updateMany({
    where: { workspaceId, metric, period: period(), count: { gte: amount } },
    data: { count: { decrement: amount } },
  });
}

export const METRIC = {
  TRIAGE: "ai_triage",
  DRAFT: "ai_draft",
  BROADCAST_RECIPIENTS: "broadcast_recipients",
  FREE_BROADCAST: "free_broadcast",
} as const;
