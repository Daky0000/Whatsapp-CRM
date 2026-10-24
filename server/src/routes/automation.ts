import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { billingOf } from "../services/usage.js";

/** Auto-replies, the product catalogue and the FAQ the AI answers from. */
export const automationRouter = Router();

automationRouter.get(
  "/auto-replies",
  h(async (req, res) => {
    res.json(await prisma.autoReplyRule.findMany({ where: { workspaceId: ws(req) }, orderBy: { createdAt: "asc" } }));
  }),
);

const Rule = z
  .object({
    trigger: z.enum(["KEYWORD", "AWAY", "WELCOME"]),
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    reply: z.string().trim().min(1).max(1000),
    active: z.boolean().default(true),
  })
  .refine((r) => r.trigger !== "KEYWORD" || r.keywords.length > 0, { message: "add at least one keyword", path: ["keywords"] });

automationRouter.post(
  "/auto-replies",
  h(async (req, res) => {
    const data = parse(Rule, req.body);
    const { limits } = await billingOf(ws(req));
    if ((await prisma.autoReplyRule.count({ where: { workspaceId: ws(req) } })) >= limits.autoReplyRules) {
      throw new HttpError(402, `Your plan includes ${limits.autoReplyRules} auto-reply rules. Upgrade to Pro for unlimited.`);
    }
    if (data.trigger !== "KEYWORD" && (await prisma.autoReplyRule.count({ where: { workspaceId: ws(req), trigger: data.trigger } }))) {
      throw new HttpError(409, `You already have a ${data.trigger.toLowerCase()} message. Edit that one instead.`);
    }
    res.status(201).json(await prisma.autoReplyRule.create({ data: { ...data, workspaceId: ws(req) } }));
  }),
);

automationRouter.patch(
  "/auto-replies/:id",
  h(async (req, res) => {
    const data = parse(
      z.object({ keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(), reply: z.string().trim().min(1).max(1000).optional(), active: z.boolean().optional() }),
      req.body,
    );
    const updated = await prisma.autoReplyRule.updateMany({ where: { id: param(req, "id"), workspaceId: ws(req) }, data });
    if (!updated.count) throw new HttpError(404, "Rule not found.");
    res.json({ ok: true });
  }),
);

automationRouter.delete(
  "/auto-replies/:id",
  h(async (req, res) => {
    await prisma.autoReplyRule.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    res.json({ ok: true });
  }),
);

// --- Products ---

automationRouter.get(
  "/products",
  h(async (req, res) => {
    res.json(await prisma.product.findMany({ where: { workspaceId: ws(req) }, orderBy: { name: "asc" } }));
  }),
);

const ProductInput = z.object({
  name: z.string().trim().min(1).max(120),
  priceGhs: z.coerce.number().nonnegative().max(1_000_000),
  description: z.string().trim().max(500).nullable().optional(),
  inStock: z.boolean().default(true),
});

automationRouter.post(
  "/products",
  h(async (req, res) => {
    const data = parse(ProductInput, req.body);
    const { limits } = await billingOf(ws(req));
    if ((await prisma.product.count({ where: { workspaceId: ws(req) } })) >= limits.products) {
      throw new HttpError(402, `Your plan includes ${limits.products} products. Upgrade to Pro for unlimited.`);
    }
    res.status(201).json(await prisma.product.create({ data: { ...data, workspaceId: ws(req) } }));
  }),
);

automationRouter.patch(
  "/products/:id",
  h(async (req, res) => {
    const data = parse(ProductInput.partial(), req.body);
    const updated = await prisma.product.updateMany({ where: { id: param(req, "id"), workspaceId: ws(req) }, data });
    if (!updated.count) throw new HttpError(404, "Product not found.");
    res.json({ ok: true });
  }),
);

automationRouter.delete(
  "/products/:id",
  h(async (req, res) => {
    await prisma.product.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    res.json({ ok: true });
  }),
);

// --- Knowledge / FAQ ---

automationRouter.get(
  "/knowledge",
  h(async (req, res) => {
    res.json(await prisma.knowledgeItem.findMany({ where: { workspaceId: ws(req) }, orderBy: { createdAt: "asc" } }));
  }),
);

const Knowledge = z.object({ question: z.string().trim().min(2).max(300), answer: z.string().trim().min(1).max(1500) });

automationRouter.post(
  "/knowledge",
  h(async (req, res) => {
    const data = parse(Knowledge, req.body);
    if ((await prisma.knowledgeItem.count({ where: { workspaceId: ws(req) } })) >= 100) throw new HttpError(400, "Up to 100 FAQ entries.");
    res.status(201).json(await prisma.knowledgeItem.create({ data: { ...data, workspaceId: ws(req) } }));
  }),
);

automationRouter.delete(
  "/knowledge/:id",
  h(async (req, res) => {
    await prisma.knowledgeItem.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    res.json({ ok: true });
  }),
);
