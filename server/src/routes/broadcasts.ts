import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { quote, recipientsFor, sendBroadcast } from "../services/broadcasts.js";
import { assertActive, billingOf } from "../services/usage.js";

export const broadcastsRouter = Router();

// --- Lists ---

broadcastsRouter.get(
  "/lists",
  h(async (req, res) => {
    const lists = await prisma.broadcastList.findMany({
      where: { workspaceId: ws(req) },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { members: true } } },
    });
    res.json(lists.map((l) => ({ id: l.id, name: l.name, members: l._count.members, createdAt: l.createdAt })));
  }),
);

const ListInput = z.object({ name: z.string().trim().min(1).max(80) });

broadcastsRouter.post(
  "/lists",
  h(async (req, res) => {
    const { name } = parse(ListInput, req.body);
    const { limits } = await billingOf(ws(req));
    if ((await prisma.broadcastList.count({ where: { workspaceId: ws(req) } })) >= limits.lists) {
      throw new HttpError(402, `Your plan includes ${limits.lists} broadcast lists. Upgrade to Pro for unlimited lists.`);
    }
    res.status(201).json(await prisma.broadcastList.create({ data: { workspaceId: ws(req), name } }));
  }),
);

broadcastsRouter.delete(
  "/lists/:id",
  h(async (req, res) => {
    const removed = await prisma.broadcastList.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!removed.count) throw new HttpError(404, "List not found.");
    res.json({ ok: true });
  }),
);

const Members = z.object({ contactIds: z.array(z.string()).min(1).max(5000), remove: z.boolean().default(false) });

broadcastsRouter.post(
  "/lists/:id/members",
  h(async (req, res) => {
    const { contactIds, remove } = parse(Members, req.body);
    const list = await prisma.broadcastList.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!list) throw new HttpError(404, "List not found.");
    // Only contacts that belong to this workspace, whatever ids were sent.
    const owned = await prisma.contact.findMany({ where: { id: { in: contactIds }, workspaceId: ws(req) }, select: { id: true } });
    if (remove) {
      await prisma.broadcastListMember.deleteMany({ where: { listId: list.id, contactId: { in: owned.map((c) => c.id) } } });
    } else {
      await prisma.broadcastListMember.createMany({ data: owned.map((c) => ({ listId: list.id, contactId: c.id })), skipDuplicates: true });
    }
    res.json({ ok: true, affected: owned.length });
  }),
);

// --- Broadcasts ---

broadcastsRouter.get(
  "/broadcasts",
  h(async (req, res) => {
    const broadcasts = await prisma.broadcast.findMany({
      where: { workspaceId: ws(req) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { list: { select: { name: true } }, recipients: { select: { status: true } } },
    });
    res.json(
      broadcasts.map(({ recipients, ...b }) => ({
        ...b,
        costGhs: b.costPesewas / 100,
        stats: recipients.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
      })),
    );
  }),
);

const BroadcastInput = z.object({
  name: z.string().trim().min(1).max(120),
  listId: z.string(),
  templateName: z.string().regex(/^[a-z0-9_]+$/, "template names are lowercase letters, numbers and _"),
  templateLang: z.string().min(2).max(10).default("en"),
  variables: z.array(z.string().max(500)).max(10).default([]),
  scheduledAt: z.coerce.date().nullable().optional(),
});

broadcastsRouter.post(
  "/broadcasts",
  h(async (req, res) => {
    const body = parse(BroadcastInput, req.body);
    const limits = await assertActive(ws(req));
    if (!(await prisma.broadcastList.findFirst({ where: { id: body.listId, workspaceId: ws(req) } }))) throw new HttpError(404, "List not found.");
    if (body.scheduledAt) {
      if (!limits.scheduledBroadcasts) throw new HttpError(402, "Scheduled broadcasts are on the Pro plan.");
      if (body.scheduledAt.getTime() < Date.now() + 60_000) throw new HttpError(400, "Schedule at least a minute from now.");
    }
    const broadcast = await prisma.broadcast.create({
      data: { ...body, workspaceId: ws(req), status: body.scheduledAt ? "SCHEDULED" : "DRAFT" },
    });
    res.status(201).json(broadcast);
  }),
);

broadcastsRouter.get(
  "/broadcasts/:id/quote",
  h(async (req, res) => {
    const b = await prisma.broadcast.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!b?.listId) throw new HttpError(404, "Broadcast not found.");
    const recipients = await recipientsFor(ws(req), b.listId);
    const q = await quote(ws(req), recipients.length);
    res.json({ ...q, costGhs: q.costPesewas / 100, notOptedIn: recipients.filter((r) => !r.optedIn).length });
  }),
);

broadcastsRouter.post(
  "/broadcasts/:id/send",
  h(async (req, res) => {
    const b = await prisma.broadcast.findFirst({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!b) throw new HttpError(404, "Broadcast not found.");
    await sendBroadcast(ws(req), b.id);
    res.json(await prisma.broadcast.findUnique({ where: { id: b.id } }));
  }),
);

broadcastsRouter.post(
  "/broadcasts/:id/cancel",
  h(async (req, res) => {
    const updated = await prisma.broadcast.updateMany({
      where: { id: param(req, "id"), workspaceId: ws(req), status: { in: ["DRAFT", "SCHEDULED"] } },
      data: { status: "CANCELLED" },
    });
    if (!updated.count) throw new HttpError(409, "Only drafts and scheduled broadcasts can be cancelled.");
    res.json({ ok: true });
  }),
);
