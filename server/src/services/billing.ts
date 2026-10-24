import type { PlanId } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { createPlan, disableSubscription, initializeTransaction, toPesewas, verifyTransaction } from "../lib/paystack.js";
import { PLANS, priceFor } from "../lib/plans.js";

const callbackUrl = () => process.env.PAYSTACK_CALLBACK_URL || `${config.publicUrl}/billing`;

function newReference(kind: "sub" | "wal") {
  return `wcrm-${kind}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

/** Paystack plan codes: from the environment, else created once and remembered. */
async function paystackPlanCode(plan: PlanId, months: 1 | 12): Promise<string> {
  const fromEnv = months === 1 ? process.env[`PAYSTACK_PLAN_${plan}`] : undefined;
  if (fromEnv) return fromEnv;
  const key = `paystack_plan_${plan}_${months}`;
  const stored = await prisma.appSetting.findUnique({ where: { key } });
  if (stored) return stored.value;
  const code = await createPlan(
    `WhatsApp CRM ${PLANS[plan].name}${months === 12 ? " (annual)" : ""}`,
    toPesewas(priceFor(plan, months)),
    months === 12 ? "annually" : "monthly",
  );
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: code }, update: { value: code } });
  return code;
}

/**
 * Opens Paystack checkout for a plan. `autoRenew` makes it a Paystack
 * subscription (card only, renews by itself). Otherwise it is a one-off
 * payment for one or twelve months, which is how MoMo users pay.
 */
export async function startSubscriptionCheckout(input: {
  workspaceId: string;
  email: string;
  plan: PlanId;
  months: 1 | 12;
  autoRenew: boolean;
}) {
  const amountPesewas = toPesewas(priceFor(input.plan, input.months));
  const reference = newReference("sub");
  await prisma.payment.create({
    data: { workspaceId: input.workspaceId, reference, kind: "SUBSCRIPTION", plan: input.plan, months: input.months, amountPesewas },
  });
  await prisma.workspace.update({ where: { id: input.workspaceId }, data: { billingEmail: input.email } });
  return withPaymentCleanup(reference, async () =>
    initializeTransaction({
      email: input.email,
      amountPesewas,
      reference,
      callbackUrl: callbackUrl(),
      metadata: { product: "whatsapp-crm", workspaceId: input.workspaceId, kind: "subscription", plan: input.plan, months: input.months },
      plan: input.autoRenew ? await paystackPlanCode(input.plan, input.months) : undefined,
    }),
  );
}

/** A checkout Paystack refused to open was never seen by a customer; drop its row so reconciliation ignores it. */
async function withPaymentCleanup<T>(reference: string, open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (err) {
    await prisma.payment.deleteMany({ where: { reference, status: "PENDING" } });
    throw err;
  }
}

export async function startWalletTopUp(input: { workspaceId: string; email: string; amountGhs: number }) {
  if (input.amountGhs < 10 || input.amountGhs > 10_000) throw new HttpError(400, "Top up between GHS 10 and GHS 10,000.");
  const amountPesewas = toPesewas(input.amountGhs);
  const reference = newReference("wal");
  await prisma.payment.create({ data: { workspaceId: input.workspaceId, reference, kind: "WALLET", amountPesewas } });
  return withPaymentCleanup(reference, () =>
    initializeTransaction({
      email: input.email,
      amountPesewas,
      reference,
      callbackUrl: callbackUrl(),
      metadata: { product: "whatsapp-crm", workspaceId: input.workspaceId, kind: "wallet" },
    }),
  );
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0); // 31 Jan + 1 month = 28/29 Feb, not 3 Mar
  return d;
}

/**
 * Applies a payment exactly once, whichever arrives first: the browser coming
 * back from checkout or Paystack's webhook. Always re-verifies with Paystack;
 * a callback URL is not proof of payment.
 */
export async function applyPayment(reference: string): Promise<"applied" | "already" | "unpaid" | "unknown"> {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return "unknown";
  if (payment.status === "PAID") return "already";

  const tx = await verifyTransaction(reference);
  if (!tx.paid) {
    // "abandoned" or "ongoing" may still turn into a payment; only a definite failure is final.
    if (tx.status === "failed") await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return "unpaid";
  }
  if (tx.currency !== "GHS" || tx.amountPesewas !== payment.amountPesewas) {
    console.error(`[billing] ${reference}: paid ${tx.amountPesewas} ${tx.currency}, expected ${payment.amountPesewas} GHS`);
    throw new HttpError(409, "The amount paid doesn't match. Please contact support.");
  }

  return prisma.$transaction(async (db) => {
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: { not: "PAID" } },
      data: { status: "PAID", paidAt: tx.paidAt ?? new Date(), channel: tx.channel },
    });
    if (claimed.count !== 1) return "already" as const;

    if (payment.kind === "WALLET") {
      await db.workspace.update({ where: { id: payment.workspaceId }, data: { walletPesewas: { increment: payment.amountPesewas } } });
      await db.walletTransaction.create({
        data: { workspaceId: payment.workspaceId, amountPesewas: payment.amountPesewas, description: "Wallet top-up", reference },
      });
      return "applied" as const;
    }

    const w = await db.workspace.findUniqueOrThrow({ where: { id: payment.workspaceId } });
    const changingPlan = w.status === "ACTIVE" && w.plan !== payment.plan;
    // Renewals stack on the current period; a plan change starts a fresh period today.
    const base = !changingPlan && w.currentPeriodEnd && w.currentPeriodEnd > new Date() ? w.currentPeriodEnd : new Date();
    await db.workspace.update({
      where: { id: w.id },
      data: {
        plan: payment.plan ?? w.plan,
        status: "ACTIVE",
        currentPeriodEnd: addMonths(base, payment.months ?? 1),
        paystackCustomer: tx.customerCode ?? w.paystackCustomer,
        cancelAtPeriodEnd: false,
      },
    });
    return "applied" as const;
  });
}

interface PaystackEvent {
  event: string;
  data: {
    reference?: string;
    subscription_code?: string;
    customer?: { customer_code?: string; email?: string };
    plan?: { plan_code?: string; interval?: string } | Record<string, never>;
    metadata?: { product?: string } | string | null;
  };
}

export async function handlePaystackEvent(evt: PaystackEvent): Promise<void> {
  const customer = evt.data.customer?.customer_code;
  const workspace = customer ? await prisma.workspace.findFirst({ where: { paystackCustomer: customer } }) : null;

  switch (evt.event) {
    case "charge.success": {
      const reference = evt.data.reference;
      if (!reference) return;
      const outcome = await applyPayment(reference);
      // A renewal charged by a Paystack subscription carries a reference we never issued.
      if (outcome === "unknown" && workspace && evt.data.plan && "plan_code" in evt.data.plan) {
        const months = evt.data.plan.interval === "annually" ? 12 : 1;
        const tx = await verifyTransaction(reference);
        if (!tx.paid) return;
        await prisma.payment.create({
          data: { workspaceId: workspace.id, reference, kind: "SUBSCRIPTION", plan: workspace.plan, months, amountPesewas: tx.amountPesewas },
        });
        await applyPayment(reference);
      }
      return;
    }
    case "subscription.create":
      if (workspace && evt.data.subscription_code) {
        await prisma.workspace.update({ where: { id: workspace.id }, data: { paystackSubCode: evt.data.subscription_code } });
      }
      return;
    case "subscription.not_renew":
    case "subscription.disable":
      if (workspace) await prisma.workspace.update({ where: { id: workspace.id }, data: { cancelAtPeriodEnd: true } });
      return;
    case "invoice.payment_failed":
      if (workspace) await prisma.workspace.update({ where: { id: workspace.id }, data: { status: "PAST_DUE" } });
      return;
  }
}

export async function cancelAutoRenew(workspaceId: string) {
  const w = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (w.paystackSubCode) await disableSubscription(w.paystackSubCode);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { cancelAtPeriodEnd: true } });
}

/** Moves trials and periods that have run out into the right state. Run by the scheduler. */
export async function expireLapsed(now = new Date()) {
  const GRACE_MS = 3 * 86_400_000;
  await prisma.workspace.updateMany({ where: { status: "TRIALING", trialEndsAt: { lt: now } }, data: { status: "EXPIRED" } });
  await prisma.workspace.updateMany({ where: { status: "ACTIVE", currentPeriodEnd: { lt: now } }, data: { status: "PAST_DUE" } });
  await prisma.workspace.updateMany({
    where: { status: "PAST_DUE", currentPeriodEnd: { lt: new Date(now.getTime() - GRACE_MS) } },
    data: { status: "EXPIRED" },
  });
}
