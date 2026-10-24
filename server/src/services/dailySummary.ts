import { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { escapeHtml, mailConfigured, sendMail } from "../lib/mail.js";
import { isActive } from "../lib/plans.js";

export interface DailySummary {
  date: string;
  newChats: number;
  newOrders: number;
  paidGhs: number;
  repliesWaiting: number;
  unanswered: Array<{ conversationId: string; name: string; waitingHours: number }>;
  openComplaints: number;
}

const DAY_MS = 86_400_000;

/** Yesterday (Accra = UTC) in numbers, plus what still needs the seller right now. */
export async function dailySummary(workspaceId: string, now = new Date()): Promise<DailySummary> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - DAY_MS);

  const [[chats], newOrders, paid, repliesWaiting, unanswered, openComplaints] = await Promise.all([
    // New = the chat's first message was yesterday, so a history sync doesn't count as new leads.
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS n FROM (
        SELECT c.id FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c.id
        WHERE c."workspaceId" = ${workspaceId} AND c.category <> 'NOT_BUSINESS'
        GROUP BY c.id HAVING MIN(m."timestamp") >= ${start} AND MIN(m."timestamp") < ${end}
      ) x`),
    prisma.order.count({ where: { workspaceId, createdAt: { gte: start, lt: end } } }),
    prisma.order.aggregate({ where: { workspaceId, paidAt: { gte: start, lt: end } }, _sum: { paymentPesewas: true } }),
    prisma.draft.count({ where: { workspaceId, status: "PENDING" } }),
    // The customer spoke last, over an hour ago, in a business chat: they're waiting on the seller.
    prisma.$queryRaw<Array<{ id: string; name: string | null; phone: string; last: Date }>>(Prisma.sql`
      SELECT c.id, ct.name, ct.phone, c."lastMessageAt" AS last
      FROM "Conversation" c JOIN "Contact" ct ON ct.id = c."contactId"
      WHERE c."workspaceId" = ${workspaceId} AND c.category NOT IN ('NOT_BUSINESS', 'UNSORTED')
        AND c."lastInboundAt" IS NOT NULL AND c."lastInboundAt" = c."lastMessageAt"
        AND c."lastInboundAt" < ${new Date(now.getTime() - 3_600_000)}
        AND c."lastInboundAt" > ${new Date(now.getTime() - 7 * DAY_MS)}
      ORDER BY c."lastInboundAt" ASC LIMIT 10`),
    prisma.conversation.count({ where: { workspaceId, category: "COMPLAINT", stage: { notIn: ["DELIVERED", "LOST"] } } }),
  ]);

  return {
    date: start.toISOString().slice(0, 10),
    newChats: Number(chats?.n ?? 0),
    newOrders,
    paidGhs: (paid._sum.paymentPesewas ?? 0) / 100,
    repliesWaiting,
    unanswered: unanswered.map((u) => ({
      conversationId: u.id,
      name: u.name ?? `+${u.phone}`,
      waitingHours: Math.round((now.getTime() - u.last.getTime()) / 3_600_000),
    })),
    openComplaints,
  };
}

function render(name: string, s: DailySummary) {
  const lines = [
    `${s.newChats} new customer chat${s.newChats === 1 ? "" : "s"}`,
    `${s.newOrders} order${s.newOrders === 1 ? "" : "s"} captured`,
    ...(s.paidGhs ? [`GHS ${s.paidGhs.toFixed(2)} paid through payment links`] : []),
  ];
  const todo = [
    ...(s.repliesWaiting ? [`${s.repliesWaiting} AI repl${s.repliesWaiting === 1 ? "y is" : "ies are"} ready for your approval`] : []),
    ...(s.unanswered.length ? [`${s.unanswered.length} customer${s.unanswered.length === 1 ? " is" : "s are"} waiting for an answer: ${s.unanswered.slice(0, 5).map((u) => `${u.name} (${u.waitingHours}h)`).join(", ")}`] : []),
    ...(s.openComplaints ? [`${s.openComplaints} open complaint${s.openComplaints === 1 ? "" : "s"}`] : []),
  ];
  const link = `${config.publicUrl}/inbox`;
  const text = `Good morning from ${name}'s WhatsApp CRM.\n\nYesterday:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n${todo.length ? `Today:\n${todo.map((l) => `- ${l}`).join("\n")}\n\n` : ""}Open your inbox: ${link}\n\nTo stop these emails: Settings → Your business.`;
  const li = (items: string[]) => items.map((l) => `<li style="margin:4px 0">${escapeHtml(l)}</li>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#1b1f23">
<p style="color:#0f7a4a;font-weight:600;margin:0 0 12px">Good morning from your WhatsApp CRM</p>
<p style="margin:0 0 4px;font-weight:600">Yesterday at ${escapeHtml(name)}</p><ul style="padding-left:18px;margin:0 0 16px">${li(lines)}</ul>
${todo.length ? `<p style="margin:0 0 4px;font-weight:600">Needs you today</p><ul style="padding-left:18px;margin:0 0 16px">${li(todo)}</ul>` : ""}
<p><a href="${link}" style="background:#0f7a4a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open my inbox</a></p>
<p style="color:#5b6670;font-size:12px;margin-top:24px">To stop these emails: Settings → Your business.</p></div>`;
  return { text, html };
}

const SEND_FROM_HOUR_UTC = 7; // 7am in Accra

/** Hourly: once per day after 7am, email each active workspace's owners. Claims the day first, so a restart can't double-send. */
export async function sendDailySummaries(now = new Date()) {
  if (!mailConfigured() || now.getUTCHours() < SEND_FROM_HOUR_UTC) return;
  const today = now.toISOString().slice(0, 10);
  const due = await prisma.workspace.findMany({
    where: { dailySummaryEmail: true, OR: [{ dailySummarySentOn: null }, { dailySummarySentOn: { not: today } }] },
    select: { id: true, name: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, users: { where: { role: "OWNER" }, select: { email: true } } },
    take: 200,
  });
  for (const w of due) {
    const claimed = await prisma.workspace.updateMany({
      where: { id: w.id, OR: [{ dailySummarySentOn: null }, { dailySummarySentOn: { not: today } }] },
      data: { dailySummarySentOn: today },
    });
    if (!claimed.count || !isActive(w)) continue;
    const s = await dailySummary(w.id, now);
    // A quiet day with nothing waiting isn't worth an email.
    if (!s.newChats && !s.newOrders && !s.repliesWaiting && !s.unanswered.length && !s.openComplaints) continue;
    const { text, html } = render(w.name, s);
    for (const u of w.users) {
      await sendMail({ to: u.email, subject: `${w.name}: ${s.newChats} new chats, ${s.newOrders} orders yesterday`, text, html }).catch((err) =>
        console.warn(`[daily-summary] ${w.id}: ${(err as Error).message}`),
      );
    }
  }
}
