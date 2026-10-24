import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db.js";
import { ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h } from "../lib/http.js";
import { billingOf } from "../services/usage.js";

export const analyticsRouter = Router();

const BUSINESS = ["NEW_LEAD", "ORDER", "INQUIRY", "COMPLAINT", "FOLLOW_UP"];

interface DayRow {
  day: string;
  newChats: number;
  orders: number;
  paidGhs: number;
}

// Prisma stores timestamps as UTC without a zone, so every now() here is pinned to UTC.
// Accra is UTC+0 all year, so UTC days are the seller's days.

/**
 * One row per day for the last `days` days, zero-filled. A chat counts as new
 * on the day of its FIRST message, not when its row was created, or a history
 * sync would make every old customer look like today's lead.
 */
async function daily(workspaceId: string, days: number): Promise<DayRow[]> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; new_chats: bigint; orders: bigint; paid: Prisma.Decimal | null }>>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - (${days - 1} * interval '1 day'), date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS day
    ),
    firsts AS (
      SELECT date_trunc('day', MIN(m."timestamp")) AS day
      FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
      WHERE c."workspaceId" = ${workspaceId} AND c.category::text = ANY(${BUSINESS})
      GROUP BY c.id
    ),
    o AS (
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS n FROM "Order" WHERE "workspaceId" = ${workspaceId} GROUP BY 1
    ),
    p AS (
      SELECT date_trunc('day', "paidAt") AS day, SUM("paymentPesewas") / 100.0 AS ghs FROM "Order"
      WHERE "workspaceId" = ${workspaceId} AND "paidAt" IS NOT NULL GROUP BY 1
    )
    SELECT d.day,
      (SELECT COUNT(*) FROM firsts f WHERE f.day = d.day) AS new_chats,
      COALESCE((SELECT n FROM o WHERE o.day = d.day), 0) AS orders,
      (SELECT ghs FROM p WHERE p.day = d.day) AS paid
    FROM days d ORDER BY d.day`);
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    newChats: Number(r.new_chats),
    orders: Number(r.orders),
    paidGhs: r.paid ? Number(r.paid) : 0,
  }));
}

/**
 * How long customers wait. A "turn" starts at a customer message that follows
 * a seller message (or opens the chat); the wait is until the seller's next
 * message. Auto-replies don't count: an instant canned reply isn't an answer.
 */
async function responseTimes(workspaceId: string, days: number) {
  const [row] = await prisma.$queryRaw<Array<{ median: number | null; p90: number | null; turns: bigint; within_1h: bigint }>>(Prisma.sql`
    WITH msgs AS (
      SELECT m."conversationId", m.direction, m."timestamp", m."autoRuleId",
        LAG(m.direction) OVER (PARTITION BY m."conversationId" ORDER BY m."timestamp") AS prev
      FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."workspaceId" = ${workspaceId} AND c.category::text <> 'NOT_BUSINESS'
        AND m."timestamp" >= (now() AT TIME ZONE 'UTC') - (${days} * interval '1 day')
        AND (m.direction = 'INBOUND' OR m."autoRuleId" IS NULL)
    ),
    turns AS (
      SELECT EXTRACT(EPOCH FROM (
        SELECT MIN(r."timestamp") FROM msgs r
        WHERE r."conversationId" = t."conversationId" AND r.direction = 'OUTBOUND' AND r."timestamp" > t."timestamp"
      ) - t."timestamp") / 60.0 AS minutes
      FROM msgs t WHERE t.direction = 'INBOUND' AND (t.prev IS NULL OR t.prev = 'OUTBOUND')
    )
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes) AS p90,
           COUNT(minutes) AS turns,
           COUNT(*) FILTER (WHERE minutes <= 60) AS within_1h
    FROM turns WHERE minutes IS NOT NULL`);
  return {
    medianMinutes: row?.median === null || row?.median === undefined ? null : Math.round(Number(row.median)),
    p90Minutes: row?.p90 === null || row?.p90 === undefined ? null : Math.round(Number(row.p90)),
    answeredTurns: Number(row?.turns ?? 0),
    within1h: Number(row?.within_1h ?? 0),
  };
}

function rangeDays(raw: unknown): number {
  const n = Number(raw);
  return [7, 30, 90].includes(n) ? n : 30;
}

analyticsRouter.get(
  "/analytics",
  h(async (req, res) => {
    const workspaceId = ws(req);
    const days = rangeDays(req.query.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const [perDay, response, categories, orders, broadcasts] = await Promise.all([
      daily(workspaceId, days),
      responseTimes(workspaceId, days),
      prisma.conversation.groupBy({ by: ["category"], where: { workspaceId, lastMessageAt: { gte: since } }, _count: true }),
      prisma.order.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { stage: true, totalGhs: true, paidAt: true, paymentPesewas: true } }),
      prisma.broadcast.findMany({
        where: { workspaceId, sentAt: { gte: since } },
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { id: true, name: true, sentAt: true, costPesewas: true, recipients: { select: { status: true } } },
      }),
    ]);
    const newChats = perDay.reduce((s, d) => s + d.newChats, 0);
    const won = orders.filter((o) => ["ORDERED", "PAID", "DELIVERED"].includes(o.stage));
    res.json({
      days,
      perDay,
      response,
      categories: Object.fromEntries(categories.map((c) => [c.category, c._count])),
      funnel: {
        newChats,
        orders: orders.length,
        confirmed: won.length,
        paid: orders.filter((o) => o.paidAt).length,
        conversion: newChats ? orders.length / newChats : null,
      },
      revenue: {
        confirmedGhs: won.reduce((s, o) => s + Number(o.totalGhs ?? 0), 0),
        paidThroughLinksGhs: orders.reduce((s, o) => s + (o.paidAt ? (o.paymentPesewas ?? 0) / 100 : 0), 0),
      },
      broadcasts: broadcasts.map((b) => {
        const count = (status: string) => b.recipients.filter((r) => r.status === status).length;
        return {
          id: b.id,
          name: b.name,
          sentAt: b.sentAt,
          costGhs: b.costPesewas / 100,
          recipients: b.recipients.length,
          // A read message was delivered too; WhatsApp only reports the latest state.
          delivered: count("DELIVERED") + count("READ"),
          read: count("READ"),
          failed: count("FAILED"),
        };
      }),
    });
  }),
);

analyticsRouter.get(
  "/analytics/export.csv",
  h(async (req, res) => {
    const { limits } = await billingOf(ws(req));
    if (!limits.analyticsExport) throw new HttpError(402, "Exporting analytics is on the Pro plan.");
    const days = rangeDays(req.query.days);
    const rows = await daily(ws(req), days);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="whatsapp-crm-${days}d.csv"`);
    res.send(["date,new_business_chats,orders_captured,paid_through_links_ghs"].concat(rows.map((r) => `${r.day},${r.newChats},${r.orders},${r.paidGhs.toFixed(2)}`)).join("\n"));
  }),
);
