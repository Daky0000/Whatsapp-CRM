import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ws } from "../lib/auth.js";
import { parseChatExport } from "../lib/chatExport.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { normalizePhone } from "../lib/phone.js";
import { recordMessage } from "../services/inbound.js";
import { triageConversation } from "../services/triage.js";
import { billingOf } from "../services/usage.js";
import { checkOrderPayment, createOrderPaymentLink } from "../services/payLinks.js";
import { dailySummary } from "../services/dailySummary.js";

/** Orders, chat-export import and the dashboard. */
export const businessRouter = Router();

businessRouter.get(
  "/orders",
  h(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { workspaceId: ws(req) },
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: { contact: { select: { name: true, phone: true } } },
    });
    res.json(orders);
  }),
);

const OrderPatch = z.object({
  stage: z.enum(["NEW", "NEGOTIATING", "ORDERED", "PAID", "DELIVERED", "LOST"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
  deliveryLocation: z.string().max(300).nullable().optional(),
  totalGhs: z.coerce.number().nonnegative().nullable().optional(),
});

businessRouter.patch(
  "/orders/:id",
  h(async (req, res) => {
    const data = parse(OrderPatch, req.body);
    const { limits } = await billingOf(ws(req));
    if (!limits.orderPipeline) throw new HttpError(402, "Managing the order pipeline is on the Pro plan. Starter can view captured orders.");
    const order = await prisma.order.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!order) throw new HttpError(404, "Order not found.");
    await prisma.order.update({ where: { id: order.id }, data });
    if (data.stage) await prisma.conversation.update({ where: { id: order.conversationId }, data: { stage: data.stage } });
    res.json({ ok: true });
  }),
);

businessRouter.post(
  "/orders/:id/payment-link",
  h(async (req, res) => {
    const { amountGhs } = parse(z.object({ amountGhs: z.coerce.number().positive().max(1_000_000).optional() }), req.body ?? {});
    res.json(await createOrderPaymentLink(ws(req), param(req, "id"), amountGhs));
  }),
);

businessRouter.post(
  "/orders/:id/payment-check",
  h(async (req, res) => {
    res.json({ status: await checkOrderPayment(ws(req), param(req, "id")) });
  }),
);

// --- Chat export import (for numbers not on the Cloud API) ---

const Preview = z.object({ text: z.string().min(1).max(5_000_000) });

businessRouter.post(
  "/imports/preview",
  h(async (req, res) => {
    const { text } = parse(Preview, req.body);
    const parsed = parseChatExport(text);
    if (!parsed.messages.length) throw new HttpError(400, "That file doesn't look like a WhatsApp chat export. Export it from WhatsApp → chat → ⋮ → More → Export chat (without media).");
    res.json({
      participants: parsed.participants.map((name) => ({
        name,
        messages: parsed.messages.filter((m) => m.author === name).length,
        phone: normalizePhone(name),
      })),
      messages: parsed.messages.length,
      from: parsed.messages[0]!.timestamp,
      to: parsed.messages[parsed.messages.length - 1]!.timestamp,
    });
  }),
);

const ImportChat = z.object({
  text: z.string().min(1).max(5_000_000),
  sellerName: z.string().min(1),
  customerPhone: z.string().min(6),
  customerName: z.string().trim().max(120).optional(),
});

businessRouter.post(
  "/imports/chat",
  h(async (req, res) => {
    const body = parse(ImportChat, req.body);
    const phone = normalizePhone(body.customerPhone);
    if (!phone) throw new HttpError(400, "Enter the customer's phone number, e.g. 024 123 4567.");
    const parsed = parseChatExport(body.text);
    if (!parsed.participants.includes(body.sellerName)) throw new HttpError(400, "Pick which name in the chat is you.");

    const { limits } = await billingOf(ws(req));
    const cutoff = Date.now() - limits.historyDays * 86_400_000;
    const existing = await prisma.contact.findUnique({ where: { workspaceId_phone: { workspaceId: ws(req), phone } } });
    if (!existing) {
      const imported = await prisma.conversation.count({ where: { workspaceId: ws(req), source: { in: ["history", "import"] } } });
      if (imported >= limits.historyChats) throw new HttpError(402, `Your plan imports up to ${limits.historyChats} chats. Upgrade to Pro for more.`);
    }

    let stored = 0;
    let skippedOld = 0;
    let conversationId: string | null = null;
    for (const m of parsed.messages) {
      if (m.timestamp.getTime() < cutoff) {
        skippedOld++;
        continue;
      }
      const r = await recordMessage({
        workspaceId: ws(req),
        phone: `+${phone}`,
        direction: m.author === body.sellerName ? "OUTBOUND" : "INBOUND",
        // Exports carry no message ids. A stable fingerprint makes re-importing the same file a no-op.
        waMessageId: `import:${createHash("sha256").update([ws(req), phone, m.timestamp.toISOString(), m.author, m.body].join("\u0000")).digest("hex").slice(0, 40)}`,
        type: m.isMedia ? "media" : "text",
        body: m.isMedia ? null : m.body,
        timestamp: m.timestamp,
        profileName: body.customerName || (m.author !== body.sellerName && !normalizePhone(m.author) ? m.author : null),
        source: "import",
        origin: "app",
      });
      if (r) {
        stored++;
        conversationId = r.conversation.id;
      }
    }
    if (!conversationId) {
      throw new HttpError(400, skippedOld ? `Nothing to import: every message is older than your plan's ${limits.historyDays}-day history window.` : "This chat was already imported.");
    }
    const outcome = await triageConversation(conversationId);
    res.json({ conversationId, stored, skippedOld, triage: outcome });
  }),
);

// --- Dashboard ---

businessRouter.get(
  "/summary",
  h(async (req, res) => {
    res.json(await dailySummary(ws(req)));
  }),
);

businessRouter.get(
  "/dashboard",
  h(async (req, res) => {
    const workspaceId = ws(req);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [byCategory, pendingDrafts, waiting, newLeads, orders, inbound, outbound] = await Promise.all([
      prisma.conversation.groupBy({ by: ["category"], where: { workspaceId }, _count: true }),
      prisma.draft.count({ where: { workspaceId, status: "PENDING" } }),
      prisma.conversation.count({ where: { workspaceId, unread: { gt: 0 }, category: { not: "NOT_BUSINESS" } } }),
      prisma.conversation.count({ where: { workspaceId, category: "NEW_LEAD", createdAt: { gte: since } } }),
      prisma.order.groupBy({ by: ["stage"], where: { workspaceId }, _count: true, _sum: { totalGhs: true } }),
      prisma.message.count({ where: { conversation: { workspaceId }, direction: "INBOUND", timestamp: { gte: since } } }),
      prisma.message.count({ where: { conversation: { workspaceId }, direction: "OUTBOUND", timestamp: { gte: since } } }),
    ]);
    res.json({
      byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count])),
      pendingDrafts,
      waiting,
      newLeads7d: newLeads,
      orders: orders.map((o) => ({ stage: o.stage, count: o._count, totalGhs: Number(o._sum.totalGhs ?? 0) })),
      messages7d: { inbound, outbound },
    });
  }),
);
