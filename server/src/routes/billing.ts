import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { me, requireOwner, ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, parse } from "../lib/http.js";
import { paystackConfigured } from "../lib/paystack.js";
import { PLANS, priceFor } from "../lib/plans.js";
import { applyPayment, cancelAutoRenew, startSubscriptionCheckout, startWalletTopUp } from "../services/billing.js";
import { METRIC, billingOf, usageCount } from "../services/usage.js";
import { serializeLimits } from "./auth.js";

export const billingRouter = Router();

billingRouter.get(
  "/billing",
  h(async (req, res) => {
    const workspaceId = ws(req);
    const [w, billing, payments, wallet, usage] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      billingOf(workspaceId),
      prisma.payment.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.walletTransaction.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
      Promise.all(Object.values(METRIC).map(async (m) => [m, await usageCount(workspaceId, m)] as const)),
    ]);
    res.json({
      plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...serializeLimits(p), annualPriceGhs: priceFor(id as keyof typeof PLANS, 12) })),
      current: {
        plan: w.plan,
        status: w.status,
        active: billing.active,
        trialEndsAt: w.trialEndsAt,
        currentPeriodEnd: w.currentPeriodEnd,
        autoRenew: !!w.paystackSubCode && !w.cancelAtPeriodEnd,
        limits: serializeLimits(billing.limits),
      },
      usage: Object.fromEntries(usage),
      wallet: { balanceGhs: w.walletPesewas / 100, entries: wallet.map((e) => ({ ...e, amountGhs: e.amountPesewas / 100 })) },
      payments: payments.map((p) => ({ ...p, amountGhs: p.amountPesewas / 100 })),
      paystackReady: paystackConfigured(),
    });
  }),
);

const Checkout = z.object({
  plan: z.enum(["STARTER", "PRO"]),
  months: z.union([z.literal(1), z.literal(12)]).default(1),
  autoRenew: z.boolean().default(false),
});

billingRouter.post(
  "/billing/checkout",
  requireOwner,
  h(async (req, res) => {
    const body = parse(Checkout, req.body);
    res.json(await startSubscriptionCheckout({ workspaceId: ws(req), email: me(req).email, ...body }));
  }),
);

billingRouter.post(
  "/billing/topup",
  h(async (req, res) => {
    const { amountGhs } = parse(z.object({ amountGhs: z.coerce.number() }), req.body);
    res.json(await startWalletTopUp({ workspaceId: ws(req), email: me(req).email, amountGhs }));
  }),
);

/** The browser lands back here from Paystack with ?reference=…; we verify with Paystack, never trust the URL. */
billingRouter.post(
  "/billing/verify",
  h(async (req, res) => {
    const { reference } = parse(z.object({ reference: z.string().regex(/^wcrm-[a-z]+-[a-z0-9-]+$/) }), req.body);
    const payment = await prisma.payment.findFirst({ where: { reference, workspaceId: ws(req) } });
    if (!payment) throw new HttpError(404, "Payment not found.");
    res.json({ outcome: await applyPayment(reference) });
  }),
);

billingRouter.post(
  "/billing/cancel",
  requireOwner,
  h(async (req, res) => {
    await cancelAutoRenew(ws(req));
    res.json({ ok: true });
  }),
);
