import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { clearSession, issueSession, me, requireUser, ws } from "../lib/auth.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { h, parse } from "../lib/http.js";
import { TRIAL_DAYS } from "../lib/plans.js";
import { METRIC, billingOf, usageCount } from "../services/usage.js";

export const authRouter = Router();

const Signup = z.object({
  name: z.string().trim().min(2).max(80),
  businessName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

authRouter.post(
  "/signup",
  h(async (req, res) => {
    const body = parse(Signup, req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, "An account with that email already exists. Sign in instead.");
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: "OWNER",
        workspace: {
          create: {
            name: body.businessName,
            plan: "PRO",
            status: "TRIALING",
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
            billingEmail: body.email,
          },
        },
      },
    });
    issueSession(res, user.id);
    res.status(201).json({ ok: true });
  }),
);

const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

authRouter.post(
  "/login",
  h(async (req, res) => {
    const body = parse(Login, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, "Wrong email or password.");
    issueSession(res, user.id);
    res.json({ ok: true });
  }),
);

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get(
  "/me",
  requireUser,
  h(async (req, res) => {
    const workspaceId = ws(req);
    const [workspace, connection, billing, triage, drafts] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      prisma.whatsAppConnection.findUnique({ where: { workspaceId } }),
      billingOf(workspaceId),
      usageCount(workspaceId, METRIC.TRIAGE),
      usageCount(workspaceId, METRIC.DRAFT),
    ]);
    res.json({
      user: me(req),
      workspace: {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        status: workspace.status,
        trialEndsAt: workspace.trialEndsAt,
        currentPeriodEnd: workspace.currentPeriodEnd,
        walletGhs: workspace.walletPesewas / 100,
        businessDescription: workspace.businessDescription,
        brandVoice: workspace.brandVoice,
        replyLanguage: workspace.replyLanguage,
        hoursOpen: workspace.hoursOpen,
        hoursClose: workspace.hoursClose,
      },
      billing: { active: billing.active, limits: serializeLimits(billing.limits), usage: { triage, drafts } },
      connection: connection
        ? { mode: connection.mode, displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, coexistence: connection.coexistence, historySyncedAt: connection.historySyncedAt }
        : null,
    });
  }),
);

/** JSON has no Infinity; the client reads null as "unlimited". */
export function serializeLimits<T extends object>(limits: T) {
  return Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v === Infinity ? null : v]));
}
