import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireOwner, ws } from "../lib/auth.js";
import { config } from "../config.js";
import { encrypt, hashPassword } from "../lib/crypto.js";
import { checkSecretKey } from "../lib/paystack.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { billingOf } from "../services/usage.js";

export const settingsRouter = Router();

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM");

const Profile = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  businessDescription: z.string().trim().max(2000).nullable().optional(),
  brandVoice: z.enum(["friendly", "formal", "casual"]).optional(),
  replyLanguage: z.string().trim().min(2).max(40).optional(),
  hoursOpen: HHMM.optional(),
  hoursClose: HHMM.optional(),
  dailySummaryEmail: z.boolean().optional(),
});

settingsRouter.put(
  "/workspace",
  requireOwner,
  h(async (req, res) => {
    const data = parse(Profile, req.body);
    await prisma.workspace.update({ where: { id: ws(req) }, data });
    res.json({ ok: true });
  }),
);

settingsRouter.get(
  "/team",
  h(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { workspaceId: ws(req) },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ users, seats: (await billingOf(ws(req))).limits.seats });
  }),
);

const Member = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "use at least 8 characters").max(200),
});

settingsRouter.post(
  "/team",
  requireOwner,
  h(async (req, res) => {
    const body = parse(Member, req.body);
    const { limits } = await billingOf(ws(req));
    const count = await prisma.user.count({ where: { workspaceId: ws(req) } });
    if (count >= limits.seats) throw new HttpError(402, `Your plan includes ${limits.seats} seat${limits.seats === 1 ? "" : "s"}. Upgrade to Pro to add your team.`);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, "That email already has an account.");
    const user = await prisma.user.create({
      data: { workspaceId: ws(req), name: body.name, email: body.email, role: "AGENT", passwordHash: await hashPassword(body.password) },
      select: { id: true, name: true, email: true, role: true },
    });
    res.status(201).json(user);
  }),
);

settingsRouter.delete(
  "/team/:id",
  requireOwner,
  h(async (req, res) => {
    const removed = await prisma.user.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req), role: "AGENT" } });
    if (!removed.count) throw new HttpError(404, "Team member not found.");
    res.json({ ok: true });
  }),
);

// --- The seller's own Paystack, for payment links to their customers ---

settingsRouter.get(
  "/payments",
  h(async (req, res) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: ws(req) }, select: { merchantPaystackKeyEnc: true } });
    res.json({
      connected: !!w.merchantPaystackKeyEnc,
      // Paste this into the seller's Paystack dashboard so paid orders update instantly.
      webhookUrl: `${config.publicUrl}/webhooks/paystack-merchant/${ws(req)}`,
    });
  }),
);

settingsRouter.put(
  "/payments/merchant-key",
  requireOwner,
  h(async (req, res) => {
    const { secretKey } = parse(z.object({ secretKey: z.string().trim().min(10).max(200) }), req.body);
    const { live } = await checkSecretKey(secretKey);
    await prisma.workspace.update({ where: { id: ws(req) }, data: { merchantPaystackKeyEnc: encrypt(secretKey) } });
    res.json({ ok: true, live });
  }),
);

settingsRouter.delete(
  "/payments/merchant-key",
  requireOwner,
  h(async (req, res) => {
    await prisma.workspace.update({ where: { id: ws(req) }, data: { merchantPaystackKeyEnc: null } });
    res.json({ ok: true });
  }),
);
