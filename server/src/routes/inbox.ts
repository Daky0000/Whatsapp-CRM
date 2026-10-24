import type { Category, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { me, ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { waLink } from "../lib/phone.js";
import { scanWorkspace, triageConversation } from "../services/triage.js";
import { sendReply, windowOpen } from "../services/sender.js";
import { billingOf } from "../services/usage.js";
import { transcribeMessage } from "../services/voice.js";

export const inboxRouter = Router();

const CATEGORIES = ["UNSORTED", "NEW_LEAD", "ORDER", "INQUIRY", "COMPLAINT", "FOLLOW_UP", "NOT_BUSINESS"] as const;
const STAGES = ["NEW", "NEGOTIATING", "ORDERED", "PAID", "DELIVERED", "LOST"] as const;

inboxRouter.get(
  "/conversations",
  h(async (req, res) => {
    const category = typeof req.query.category === "string" && (CATEGORIES as readonly string[]).includes(req.query.category) ? (req.query.category as Category) : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const where: Prisma.ConversationWhereInput = {
      workspaceId: ws(req),
      // Default view hides "not business"; "ALL" shows everything.
      ...(req.query.category === "ALL" ? {} : { category: category ?? { not: "NOT_BUSINESS" } }),
      ...(req.query.pending === "1" ? { drafts: { some: { status: "PENDING" } } } : {}),
      ...(q ? { contact: { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } } : {}),
    };
    const [items, counts] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
        take: 100,
        include: {
          contact: { select: { id: true, name: true, phone: true, labels: true } },
          messages: { orderBy: { timestamp: "desc" }, take: 1, select: { body: true, type: true, direction: true, timestamp: true } },
          _count: { select: { drafts: { where: { status: "PENDING" } } } },
        },
      }),
      prisma.conversation.groupBy({ by: ["category"], where: { workspaceId: ws(req) }, _count: true }),
    ]);
    res.json({
      items: items.map((c) => ({
        id: c.id,
        contact: c.contact,
        category: c.category,
        stage: c.stage,
        summary: c.aiSummary,
        urgency: c.urgency,
        unread: c.unread,
        lastMessageAt: c.lastMessageAt,
        lastMessage: c.messages[0] ?? null,
        pendingDrafts: c._count.drafts,
        needsTriage: c.needsTriage,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.category, c._count])),
    });
  }),
);

inboxRouter.get(
  "/conversations/:id",
  h(async (req, res) => {
    const convo = await prisma.conversation.findFirst({
      where: { id: param(req, "id"), workspaceId: ws(req) },
      include: {
        contact: true,
        messages: { orderBy: { timestamp: "asc" }, take: 300 },
        drafts: { where: { status: { in: ["PENDING", "READY_TO_HAND_SEND"] } }, orderBy: { createdAt: "desc" } },
        orders: true,
      },
    });
    if (!convo) throw new HttpError(404, "Conversation not found.");
    const conn = await prisma.whatsAppConnection.findUnique({ where: { workspaceId: ws(req) }, select: { mode: true } });
    if (convo.unread) await prisma.conversation.update({ where: { id: convo.id }, data: { unread: 0 } });
    res.json({
      ...convo,
      order: convo.orders[0] ?? null,
      windowOpen: windowOpen(convo.lastInboundAt),
      sendRoute: conn?.mode === "CLOUD" ? "api" : "link",
    });
  }),
);

const Reply = z.object({ body: z.string().trim().min(1).max(4096) });

inboxRouter.post(
  "/conversations/:id/reply",
  h(async (req, res) => {
    const { body } = parse(Reply, req.body);
    const result = await sendReply({ workspaceId: ws(req), conversationId: param(req, "id"), body, userId: me(req).id });
    res.json(result);
  }),
);

const Patch = z.object({ category: z.enum(CATEGORIES).optional(), stage: z.enum(STAGES).optional() });

inboxRouter.patch(
  "/conversations/:id",
  h(async (req, res) => {
    const data = parse(Patch, req.body);
    const updated = await prisma.conversation.updateMany({ where: { id: param(req, "id"), workspaceId: ws(req) }, data });
    if (!updated.count) throw new HttpError(404, "Conversation not found.");
    if (data.stage) await prisma.order.updateMany({ where: { conversationId: param(req, "id"), workspaceId: ws(req) }, data: { stage: data.stage } });
    res.json({ ok: true });
  }),
);

inboxRouter.post(
  "/conversations/:id/triage",
  h(async (req, res) => {
    const convo = await prisma.conversation.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req) }, select: { id: true } });
    if (!convo) throw new HttpError(404, "Conversation not found.");
    res.json({ outcome: await triageConversation(convo.id) });
  }),
);

/** "Scan my chats": sorts everything not yet sorted, newest first, within the month's AI allowance. */
inboxRouter.post(
  "/conversations/scan",
  h(async (req, res) => {
    const { active } = await billingOf(ws(req));
    if (!active) throw new HttpError(402, "Your subscription has ended. Renew under Billing to use AI.");
    res.json(await scanWorkspace(ws(req)));
  }),
);

inboxRouter.post(
  "/messages/:id/transcribe",
  h(async (req, res) => {
    const message = await prisma.message.findFirst({ where: { id: param(req, "id"), conversation: { workspaceId: ws(req) } }, select: { id: true } });
    if (!message) throw new HttpError(404, "Message not found.");
    const outcome = await transcribeMessage(message.id);
    const refusals: Partial<Record<typeof outcome, [number, string]>> = {
      not_on_plan: [402, "Voice-note transcription is on the Pro plan."],
      minutes_used: [402, "You've used this month's transcription minutes."],
      off: [503, "Voice-note transcription isn't switched on for this server yet."],
      not_audio: [400, "That message isn't a voice note."],
    };
    const refusal = refusals[outcome];
    if (refusal) throw new HttpError(refusal[0], refusal[1]);
    res.json(await prisma.message.findUnique({ where: { id: message.id }, select: { transcript: true, audioSeconds: true } }));
  }),
);

// --- Drafts: the approval queue ---

inboxRouter.get(
  "/drafts",
  h(async (req, res) => {
    const drafts = await prisma.draft.findMany({
      where: { workspaceId: ws(req), status: { in: ["PENDING", "READY_TO_HAND_SEND"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { conversation: { include: { contact: { select: { name: true, phone: true } } } } },
    });
    res.json(drafts);
  }),
);

const Approve = z.object({ body: z.string().trim().min(1).max(4096).optional() });

inboxRouter.post(
  "/drafts/:id/approve",
  h(async (req, res) => {
    const { body } = parse(Approve, req.body ?? {});
    const draft = await prisma.draft.findFirst({
      where: { id: param(req, "id"), workspaceId: ws(req), status: "PENDING" },
      include: { conversation: { include: { contact: true } } },
    });
    if (!draft) throw new HttpError(404, "That draft was already handled.");
    const text = body ?? draft.body;
    // Claim it first so a double-click can't send twice.
    const claimed = await prisma.draft.updateMany({ where: { id: draft.id, status: "PENDING" }, data: { status: "APPROVED", body: text } });
    if (!claimed.count) throw new HttpError(409, "That draft was already handled.");
    try {
      const result = await sendReply({ workspaceId: ws(req), conversationId: draft.conversationId, body: text, userId: me(req).id });
      await prisma.draft.update({
        where: { id: draft.id },
        data: { status: result.route === "api" ? "SENT" : "READY_TO_HAND_SEND", decidedByUserId: me(req).id, decidedAt: new Date() },
      });
      res.json(result);
    } catch (err) {
      await prisma.draft.update({ where: { id: draft.id }, data: { status: "PENDING" } });
      throw err;
    }
  }),
);

/** wa.me drafts stay "ready" until the seller says they actually sent it; a click is not a send. */
inboxRouter.post(
  "/drafts/:id/hand-sent",
  h(async (req, res) => {
    const draft = await prisma.draft.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req), status: "READY_TO_HAND_SEND" } });
    if (!draft) throw new HttpError(404, "Draft not found.");
    await prisma.$transaction([
      prisma.draft.update({ where: { id: draft.id }, data: { status: "SENT" } }),
      prisma.message.create({
        data: { conversationId: draft.conversationId, direction: "OUTBOUND", body: draft.body, status: "SENT", sentByUserId: me(req).id, origin: "app" },
      }),
      prisma.conversation.update({ where: { id: draft.conversationId }, data: { lastMessageAt: new Date() } }),
    ]);
    res.json({ ok: true });
  }),
);

inboxRouter.get(
  "/drafts/:id/link",
  h(async (req, res) => {
    const draft = await prisma.draft.findFirst({
      where: { id: param(req, "id"), workspaceId: ws(req) },
      include: { conversation: { include: { contact: true } } },
    });
    if (!draft) throw new HttpError(404, "Draft not found.");
    res.json({ url: waLink(draft.conversation.contact.phone, draft.body) });
  }),
);

const Reject = z.object({ reason: z.string().trim().max(300).optional() });

inboxRouter.post(
  "/drafts/:id/reject",
  h(async (req, res) => {
    const { reason } = parse(Reject, req.body ?? {});
    const updated = await prisma.draft.updateMany({
      where: { id: param(req, "id"), workspaceId: ws(req), status: { in: ["PENDING", "READY_TO_HAND_SEND"] } },
      data: { status: "REJECTED", reason, decidedByUserId: me(req).id, decidedAt: new Date() },
    });
    if (!updated.count) throw new HttpError(404, "Draft not found.");
    res.json({ ok: true });
  }),
);
