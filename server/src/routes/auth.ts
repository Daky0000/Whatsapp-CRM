import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { clearSession, issueSession, me, requireUser, ws } from "../lib/auth.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { h, parse } from "../lib/http.js";
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { escapeHtml, mailConfigured, sendMail } from "../lib/mail.js";
import { normalizePhone } from "../lib/phone.js";
import { TRIAL_DAYS } from "../lib/plans.js";
import { hit, MINUTE } from "../lib/rateLimit.js";
import { anyOtpChannel, checkCode, otpChannels, sendCode } from "../services/otp.js";
import { normalizeUsername } from "../services/owner.js";
import { METRIC, billingOf, usageCount } from "../services/usage.js";

export const authRouter = Router();

const ip = (req: { ip?: string }) => req.ip ?? "unknown";

/** Which ways of receiving a code this server can offer. */
authRouter.get("/otp/channels", (_req, res) => {
  res.json({ channels: otpChannels(), mail: mailConfigured() });
});

const OtpSend = z.object({
  phone: z.string().min(6).max(30),
  purpose: z.enum(["signup", "reset"]),
  channel: z.enum(["SMS", "VOICE", "WHATSAPP"]).default("SMS"),
});

authRouter.post(
  "/otp/send",
  h(async (req, res) => {
    const body = parse(OtpSend, req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, "Enter a valid phone number, e.g. 024 123 4567.");
    // Every code costs money and can be aimed at a stranger's phone, so both the number and the caller are limited.
    hit(`otp:phone:${phone}`, 3, 10 * MINUTE, "We've sent several codes to that number. Wait 10 minutes, or dial the USSD code shown to see the last one.");
    hit(`otp:ip:${ip(req)}`, 10, 60 * MINUTE);
    const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (body.purpose === "signup" && existing) throw new HttpError(409, "That number already has an account. Sign in, or reset your password.");
    // A reset for an unknown number answers exactly like a real one, so nobody can test which numbers have accounts.
    if (body.purpose === "reset" && !existing) return res.json({ ok: true, channel: body.channel });
    res.json({ ok: true, ...(await sendCode(phone, body.purpose, body.channel)) });
  }),
);

const Signup = z.object({
  name: z.string().trim().min(2).max(80),
  businessName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().min(6).max(30),
  code: z.string().trim().max(10).optional(),
  password: z.string().min(8, "use at least 8 characters").max(200),
});

authRouter.post(
  "/signup",
  h(async (req, res) => {
    const body = parse(Signup, req.body);
    hit(`signup:ip:${ip(req)}`, 10, 60 * MINUTE);
    let phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, "Enter a valid phone number, e.g. 024 123 4567.");
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, "An account with that email already exists. Sign in instead.");
    if (await prisma.user.findUnique({ where: { phone } })) throw new HttpError(409, "That number already has an account. Sign in instead.");
    // The verified phone is also what stops one person collecting free trial after free trial.
    let verified = false;
    if (anyOtpChannel()) {
      phone = await checkCode(phone, "signup", body.code ?? "");
      verified = true;
    } else if (config.production) {
      throw new HttpError(503, "Sign-up is paused while phone verification is being set up. Please try again later.");
    }
    const user = await prisma.user.create({
      data: {
        email: body.email,
        phone,
        phoneVerifiedAt: verified ? new Date() : null,
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

/** Email, phone or username, in one field. Usernames start with a letter, so they never read as a phone number. */
async function findByIdentifier(identifier: string) {
  const value = identifier.trim();
  if (value.includes("@")) return prisma.user.findUnique({ where: { email: value.toLowerCase() } });
  const username = normalizeUsername(value);
  if (username) return prisma.user.findUnique({ where: { username } });
  const phone = normalizePhone(value);
  return phone ? prisma.user.findUnique({ where: { phone } }) : null;
}

const Login = z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

authRouter.post(
  "/login",
  h(async (req, res) => {
    const body = parse(Login, req.body);
    hit(`login:ip:${ip(req)}`, 20, 15 * MINUTE);
    hit(`login:id:${body.identifier.toLowerCase()}`, 8, 15 * MINUTE, "Too many tries for this account. Wait 15 minutes or reset your password.");
    const user = await findByIdentifier(body.identifier);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, "Wrong sign-in details or password.");
    issueSession(res, user.id);
    res.json({ ok: true });
  }),
);

// --- Forgotten password: a code by phone, or a link by email ---

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const RESET_LINK_MINUTES = 60;

authRouter.post(
  "/reset/request",
  h(async (req, res) => {
    const { identifier, channel } = parse(z.object({ identifier: z.string().trim().min(3).max(200), channel: z.enum(["SMS", "VOICE", "WHATSAPP"]).default("SMS") }), req.body);
    hit(`reset:ip:${ip(req)}`, 10, 60 * MINUTE);
    if (!identifier.includes("@")) {
      const phone = normalizePhone(identifier);
      if (!phone) throw new HttpError(400, "Enter your email or phone number.");
      hit(`otp:phone:${phone}`, 3, 10 * MINUTE, "We've sent several codes to that number. Wait 10 minutes and try again.");
      const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (user) await sendCode(phone, "reset", channel);
      return res.json({ ok: true, via: "phone", channel });
    }
    if (!mailConfigured()) throw new HttpError(503, "Email isn't set up yet. Use your phone number instead.");
    const user = await prisma.user.findUnique({ where: { email: identifier.toLowerCase() }, select: { id: true, name: true, email: true } });
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * MINUTE) } });
      const link = `${config.publicUrl}/reset?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Reset your WhatsApp CRM password",
        text: `Hello ${user.name},\n\nUse this link within ${RESET_LINK_MINUTES} minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`,
        html: `<p>Hello ${escapeHtml(user.name)},</p><p><a href="${link}">Choose a new password</a> (the link works for ${RESET_LINK_MINUTES} minutes).</p><p style="color:#5b6670">If you didn't ask for this, ignore this email. Your password stays the same.</p>`,
      }).catch((err) => console.error(`[reset] mail failed: ${(err as Error).message}`));
    }
    res.json({ ok: true, via: "email" });
  }),
);

async function setPassword(userId: string, password: string) {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
}

/** Signed in, knows the current password: change it, end every other session, keep this one. */
authRouter.post(
  "/password",
  requireUser,
  h(async (req, res) => {
    const body = parse(z.object({ current: z.string().min(1).max(200), password: z.string().min(8, "use at least 8 characters").max(200) }), req.body);
    hit(`password:${me(req).id}`, 5, 15 * MINUTE);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } });
    if (!(await verifyPassword(body.current, user.passwordHash))) throw new HttpError(400, "Your current password isn't right.");
    await setPassword(user.id, body.password);
    issueSession(res, user.id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/reset/phone",
  h(async (req, res) => {
    const body = parse(z.object({ phone: z.string().min(6).max(30), code: z.string().trim().max(10), password: z.string().min(8, "use at least 8 characters").max(200) }), req.body);
    hit(`reset-verify:ip:${ip(req)}`, 15, 15 * MINUTE);
    const phone = await checkCode(body.phone, "reset", body.code);
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) throw new HttpError(400, "That code has expired. Ask for a new one.");
    await setPassword(user.id, body.password);
    issueSession(res, user.id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/reset/token",
  h(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(20).max(200), password: z.string().min(8, "use at least 8 characters").max(200) }), req.body);
    hit(`reset-verify:ip:${ip(req)}`, 15, 15 * MINUTE);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, "That link has expired or was already used. Ask for a new one.");
    // Single use, even if two tabs submit at once.
    const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new HttpError(400, "That link was already used. Ask for a new one.");
    await setPassword(row.userId, body.password);
    issueSession(res, row.userId);
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
        dailySummaryEmail: workspace.dailySummaryEmail,
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
