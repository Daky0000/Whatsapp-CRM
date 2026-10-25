import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { issueSession, requirePlatformAdmin, type AuthedRequest } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { isActive, period } from "../lib/plans.js";
import {
  getPlatformConfigSummary,
  getSetting,
  setSetting,
} from "../lib/systemSettings.js";
import { config } from "../config.js";

/** DakyXTech staff only: platform administration, configuration, and workspace switching. */
export const adminRouter = Router();
adminRouter.use("/admin", requirePlatformAdmin);

/** Platform Overview Stats */
adminRouter.get(
  "/admin/overview",
  h(async (_req, res) => {
    const [
      totalWorkspaces,
      payingWorkspaces,
      trialWorkspaces,
      totalContacts,
      totalConversations,
      totalMessages,
      connectedCloud,
      connectedImport,
      totalAiTriages,
    ] = await Promise.all([
      prisma.workspace.count(),
      prisma.workspace.count({ where: { status: "ACTIVE" } }),
      prisma.workspace.count({ where: { status: "TRIALING" } }),
      prisma.contact.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.whatsAppConnection.count({ where: { mode: "CLOUD" } }),
      prisma.whatsAppConnection.count({ where: { mode: "IMPORT" } }),
      prisma.usageCounter.aggregate({
        where: { metric: "ai_triage" },
        _sum: { count: true },
      }),
    ]);

    // Calculate approximate MRR from active plans
    const activePlans = await prisma.workspace.findMany({
      where: { status: "ACTIVE" },
      select: { plan: true },
    });
    const mrrGhs = activePlans.reduce((sum, w) => sum + (w.plan === "PRO" ? 150 : 50), 0);

    res.json({
      totalWorkspaces,
      payingWorkspaces,
      trialWorkspaces,
      totalContacts,
      totalConversations,
      totalMessages,
      connectedCloud,
      connectedImport,
      totalAiTriages: totalAiTriages._sum.count ?? 0,
      mrrGhs,
    });
  }),
);

adminRouter.get(
  "/admin/workspaces",
  h(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const workspaces = await prisma.workspace.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              {
                users: {
                  some: {
                    OR: [
                      { email: { contains: q, mode: "insensitive" } },
                      { phone: { contains: q.replace(/\D/g, "") || q } },
                    ],
                  },
                },
              },
            ],
          }
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

/**
 * Switch active workspace for the admin user.
 * Allows the admin to preview and operate inside any workspace as a user!
 */
adminRouter.post(
  "/admin/switch-workspace/:id",
  h(async (req, res) => {
    const targetWsId = param(req, "id");
    const target = await prisma.workspace.findUnique({ where: { id: targetWsId } });
    if (!target) throw new HttpError(404, "Target workspace not found.");

    const authedUser = (req as AuthedRequest).user;
    await prisma.user.update({
      where: { id: authedUser.id },
      data: { workspaceId: targetWsId },
    });

    issueSession(res, authedUser.id);
    res.json({ ok: true, workspaceId: targetWsId, workspaceName: target.name });
  }),
);

/**
 * Return system settings summary.
 */
adminRouter.get(
  "/admin/settings",
  h(async (_req, res) => {
    const summary = await getPlatformConfigSummary();
    res.json(summary);
  }),
);

const SettingsUpdateSchema = z.object({
  whatsapp: z
    .object({
      appId: z.string().trim().optional(),
      appSecret: z.string().trim().optional(),
      configId: z.string().trim().optional(),
      verifyToken: z.string().trim().optional(),
      graphVersion: z.string().trim().optional(),
      accessToken: z.string().trim().optional(),
      phoneNumberId: z.string().trim().optional(),
      wabaId: z.string().trim().optional(),
    })
    .optional(),
  paystack: z
    .object({
      mode: z.enum(["live", "test"]).optional(),
      liveSecretKey: z.string().trim().optional(),
      livePublicKey: z.string().trim().optional(),
      testSecretKey: z.string().trim().optional(),
      testPublicKey: z.string().trim().optional(),
      starterPriceGhs: z.number().positive().optional(),
      proPriceGhs: z.number().positive().optional(),
    })
    .optional(),
  ai: z
    .object({
      apiKey: z.string().trim().optional(),
      triageModel: z.string().trim().optional(),
      draftModel: z.string().trim().optional(),
    })
    .optional(),
  vynfy: z
    .object({
      apiKey: z.string().trim().optional(),
      senderId: z.string().trim().max(11).optional(),
    })
    .optional(),
  email: z
    .object({
      fromAddress: z.string().trim().email().optional(),
      senderName: z.string().trim().optional(),
    })
    .optional(),
});

/**
 * Update system settings in DB (secrets encrypted at rest).
 */
adminRouter.put(
  "/admin/settings",
  h(async (req, res) => {
    const data = parse(SettingsUpdateSchema, req.body);

    if (data.whatsapp) {
      const wa = data.whatsapp;
      if (wa.appId !== undefined) await setSetting("META_APP_ID", wa.appId || null);
      if (wa.appSecret !== undefined && wa.appSecret !== "") await setSetting("META_APP_SECRET", wa.appSecret);
      if (wa.configId !== undefined) await setSetting("META_CONFIG_ID", wa.configId || null);
      if (wa.verifyToken !== undefined && wa.verifyToken !== "") await setSetting("WHATSAPP_VERIFY_TOKEN", wa.verifyToken);
      if (wa.graphVersion !== undefined) await setSetting("WHATSAPP_GRAPH_VERSION", wa.graphVersion || "v23.0");
      if (wa.accessToken !== undefined && wa.accessToken !== "") await setSetting("WHATSAPP_ACCESS_TOKEN", wa.accessToken);
      if (wa.phoneNumberId !== undefined) await setSetting("WHATSAPP_PHONE_NUMBER_ID", wa.phoneNumberId || null);
      if (wa.wabaId !== undefined) await setSetting("WHATSAPP_WABA_ID", wa.wabaId || null);
    }

    if (data.paystack) {
      const ps = data.paystack;
      if (ps.mode !== undefined) await setSetting("PAYSTACK_MODE", ps.mode);
      if (ps.liveSecretKey !== undefined && ps.liveSecretKey !== "") await setSetting("PAYSTACK_SECRET_KEY", ps.liveSecretKey);
      if (ps.livePublicKey !== undefined) await setSetting("PAYSTACK_PUBLIC_KEY", ps.livePublicKey || null);
      if (ps.testSecretKey !== undefined && ps.testSecretKey !== "") await setSetting("PAYSTACK_TEST_SECRET_KEY", ps.testSecretKey);
      if (ps.testPublicKey !== undefined) await setSetting("PAYSTACK_TEST_PUBLIC_KEY", ps.testPublicKey || null);
      if (ps.starterPriceGhs !== undefined) await setSetting("STARTER_PRICE_GHS", String(ps.starterPriceGhs));
      if (ps.proPriceGhs !== undefined) await setSetting("PRO_PRICE_GHS", String(ps.proPriceGhs));
    }

    if (data.ai) {
      const ai = data.ai;
      if (ai.apiKey !== undefined && ai.apiKey !== "") await setSetting("ANTHROPIC_API_KEY", ai.apiKey);
      if (ai.triageModel !== undefined) await setSetting("AI_TRIAGE_MODEL", ai.triageModel);
      if (ai.draftModel !== undefined) await setSetting("AI_DRAFT_MODEL", ai.draftModel);
    }

    if (data.vynfy) {
      const vf = data.vynfy;
      if (vf.apiKey !== undefined && vf.apiKey !== "") await setSetting("VYNFY_API_KEY", vf.apiKey);
      if (vf.senderId !== undefined) await setSetting("VYNFY_SENDER_ID", vf.senderId);
    }

    if (data.email) {
      const em = data.email;
      if (em.fromAddress !== undefined) await setSetting("MAIL_FROM_ADDRESS", em.fromAddress);
      if (em.senderName !== undefined) await setSetting("MAIL_SENDER_NAME", em.senderName);
    }

    const updated = await getPlatformConfigSummary();
    res.json({ ok: true, settings: updated });
  }),
);

/**
 * Test WhatsApp Cloud API connection.
 */
adminRouter.post(
  "/admin/test/whatsapp",
  h(async (req, res) => {
    const token = (req.body?.accessToken as string) || (await getSetting("WHATSAPP_ACCESS_TOKEN"));
    const phoneNumberId = (req.body?.phoneNumberId as string) || (await getSetting("WHATSAPP_PHONE_NUMBER_ID"));
    const graphVersion = (await getSetting("WHATSAPP_GRAPH_VERSION")) || "v23.0";

    if (!token) throw new HttpError(400, "WhatsApp Access Token is not set. Please provide or save a token first.");

    try {
      if (phoneNumberId) {
        const resp = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,throughput`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new HttpError(400, (data as { error?: { message?: string } })?.error?.message ?? `Meta returned HTTP ${resp.status}`);
        }
        res.json({
          ok: true,
          type: "phone",
          displayPhone: data.display_phone_number,
          verifiedName: data.verified_name,
          qualityRating: data.quality_rating,
          status: data.code_verification_status,
        });
      } else {
        const resp = await fetch(`https://graph.facebook.com/${graphVersion}/me?fields=id,name`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new HttpError(400, (data as { error?: { message?: string } })?.error?.message ?? `Meta returned HTTP ${resp.status}`);
        }
        res.json({
          ok: true,
          type: "account",
          accountId: data.id,
          name: data.name,
        });
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Failed to reach Meta Graph API: ${(err as Error).message}`);
    }
  }),
);

/**
 * Test Paystack API connection.
 */
adminRouter.post(
  "/admin/test/paystack",
  h(async (req, res) => {
    const mode = (req.body?.mode as string) || (await getSetting("PAYSTACK_MODE", "live"));
    const liveKey = (req.body?.secretKey as string) || (await getSetting(mode === "test" ? "PAYSTACK_TEST_SECRET_KEY" : "PAYSTACK_SECRET_KEY"));

    if (!liveKey) throw new HttpError(400, `Paystack ${mode} secret key is not set. Please enter or save your key first.`);

    try {
      const resp = await fetch("https://api.paystack.co/balance", {
        headers: { Authorization: `Bearer ${liveKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json();
      if (!resp.ok || !data.status) {
        throw new HttpError(400, data.message || `Paystack returned HTTP ${resp.status}`);
      }
      res.json({
        ok: true,
        mode,
        balances: data.data,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Failed to reach Paystack API: ${(err as Error).message}`);
    }
  }),
);

/**
 * Test Anthropic AI connection.
 */
adminRouter.post(
  "/admin/test/ai",
  h(async (req, res) => {
    const key = (req.body?.apiKey as string) || (await getSetting("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY || ""));
    const model = (req.body?.model as string) || (await getSetting("AI_TRIAGE_MODEL", config.ai.triageModel));

    if (!key) throw new HttpError(400, "Anthropic API key is not set. Please enter or save your key first.");

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Reply with 'ok'" }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new HttpError(400, (data as { error?: { message?: string } })?.error?.message ?? `Anthropic returned HTTP ${resp.status}`);
      }
      res.json({ ok: true, model, response: (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Failed to connect to Anthropic: ${(err as Error).message}`);
    }
  }),
);

/**
 * Test Vynfy gateway.
 */
adminRouter.post(
  "/admin/test/vynfy",
  h(async (req, res) => {
    const key = (req.body?.apiKey as string) || (await getSetting("VYNFY_API_KEY", process.env.VYNFY_API_KEY || ""));
    const sender = (req.body?.senderId as string) || (await getSetting("VYNFY_SENDER_ID", process.env.VYNFY_SENDER_ID || "DakyXTech"));

    if (!key) throw new HttpError(400, "Vynfy API key is not set. Please enter or save your key first.");

    try {
      const resp = await fetch("https://sms.vynfy.com/api/v1/account", {
        headers: {
          Authorization: `Bearer ${key}`,
          "User-Agent": "DakyX-WhatsApp-CRM/1.0",
        },
        signal: AbortSignal.timeout(10_000),
      });
      res.json({
        ok: resp.ok,
        status: resp.status,
        senderId: sender,
        message: resp.ok ? "Vynfy API key verified successfully" : `Vynfy returned HTTP ${resp.status}`,
      });
    } catch (err) {
      throw new HttpError(502, `Failed to connect to Vynfy: ${(err as Error).message}`);
    }
  }),
);
