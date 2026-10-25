import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePlatformAdmin } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { isActive, period } from "../lib/plans.js";

/** DakyXTech staff only: every seller workspace, for support and billing questions. Answers 404 to anyone else. */
export const adminRouter = Router();
adminRouter.use("/admin", requirePlatformAdmin);

adminRouter.get(
  "/admin/workspaces",
  h(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const workspaces = await prisma.workspace.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { users: { some: { OR: [{ email: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } } }] }
        : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        users: { where: { role: "OWNER" }, select: { name: true, email: true, phone: true, platformAdmin: true } },
        connection: { select: { mode: true, displayPhone: true } },
        usage: { where: { period: period(), metric: "ai_triage" }, select: { count: true } },
        payments: { where: { status: "PAID" }, select: { amountPesewas: true } },
        _count: { select: { conversations: true, contacts: true } },
      },
    });
    res.json(
      workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        owner: w.users[0] ?? null,
        staff: w.users.some((u) => u.platformAdmin),
        plan: w.plan,
        status: w.status,
        active: isActive(w),
        trialEndsAt: w.trialEndsAt,
        currentPeriodEnd: w.currentPeriodEnd,
        createdAt: w.createdAt,
        connection: w.connection,
        conversations: w._count.conversations,
        contacts: w._count.contacts,
        aiSortedThisMonth: w.usage[0]?.count ?? 0,
        paidGhs: w.payments.reduce((s, p) => s + p.amountPesewas, 0) / 100,
        walletGhs: w.walletPesewas / 100,
      })),
    );
  }),
);

const Extend = z.object({ plan: z.enum(["STARTER", "PRO"]), days: z.coerce.number().int().min(1).max(366) });

/** Gives a seller time without a payment (a goodwill extension, a failed MoMo renewal sorted out by phone). */
adminRouter.post(
  "/admin/workspaces/:id/extend",
  h(async (req, res) => {
    const { plan, days } = parse(Extend, req.body);
    const w = await prisma.workspace.findUnique({ where: { id: param(req, "id") } });
    if (!w) throw new HttpError(404, "Workspace not found.");
    const base = w.currentPeriodEnd && w.currentPeriodEnd > new Date() ? w.currentPeriodEnd : new Date();
    const until = new Date(base.getTime() + days * 86_400_000);
    await prisma.workspace.update({ where: { id: w.id }, data: { plan, status: "ACTIVE", currentPeriodEnd: until } });
    res.json({ ok: true, currentPeriodEnd: until });
  }),
);

