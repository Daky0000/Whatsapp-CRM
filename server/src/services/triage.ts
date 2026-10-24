import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { AiUnavailable, analyzeConversation, type TranscriptLine } from "../lib/ai.js";
import { businessContext } from "./context.js";
import { assertActive, consume, METRIC, release } from "./usage.js";

const TRANSCRIPT_MESSAGES = 30;

export type TriageOutcome = "triaged" | "drafted" | "quota" | "inactive" | "ai_off" | "empty";

/**
 * Runs the AI over one conversation: sorts it, records any order, and leaves a
 * reply draft when one is needed and the plan still has drafts this month.
 * Each call costs one triage credit; a draft costs one draft credit as well.
 */
export async function triageConversation(conversationId: string, opts: { followUp?: boolean } = {}): Promise<TriageOutcome> {
  const convo = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      contact: true,
      messages: { orderBy: { timestamp: "desc" }, take: TRANSCRIPT_MESSAGES },
    },
  });
  const workspaceId = convo.workspaceId;
  if (!convo.messages.length) return "empty";

  let limits;
  try {
    limits = await assertActive(workspaceId);
  } catch {
    return "inactive";
  }
  if (!(await consume(workspaceId, METRIC.TRIAGE, limits.aiTriagePerMonth))) return "quota";

  const lines: TranscriptLine[] = convo.messages
    .slice()
    .reverse()
    .map((m) => ({
      from: m.direction === "INBOUND" ? "customer" : "seller",
      at: m.timestamp,
      text: m.body?.trim() || (m.transcript ? `[voice note] ${m.transcript}` : `[${m.type}]`),
    }));

  const lastIsInbound = convo.messages[0]!.direction === "INBOUND";
  const wantDraft = (lastIsInbound || !!opts.followUp) && (await consume(workspaceId, METRIC.DRAFT, limits.aiDraftsPerMonth));

  let analysis;
  try {
    analysis = await analyzeConversation({ business: await businessContext(workspaceId), lines, wantDraft, followUp: opts.followUp });
  } catch (err) {
    await release(workspaceId, METRIC.TRIAGE);
    if (wantDraft) await release(workspaceId, METRIC.DRAFT);
    if (err instanceof AiUnavailable) {
      console.warn(`[triage] ${conversationId}: ${err.message}`);
      return "ai_off";
    }
    throw err;
  }
  if (wantDraft && !analysis.reply) await release(workspaceId, METRIC.DRAFT);

  const category = opts.followUp ? "FOLLOW_UP" : analysis.isBusiness ? analysis.category : "NOT_BUSINESS";

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: convo.id },
      data: {
        category,
        // Never move a deal backwards on the AI's say-so; the seller can.
        stage: stageRank(analysis.stage) > stageRank(convo.stage) ? analysis.stage : convo.stage,
        aiSummary: analysis.summary,
        urgency: analysis.urgency,
        needsTriage: false,
        triagedAt: new Date(),
      },
    });
    if (analysis.customerName && !convo.contact.name) {
      await tx.contact.update({ where: { id: convo.contactId }, data: { name: analysis.customerName } });
    }
    if (analysis.isBusiness && analysis.order?.items.length) {
      const data = {
        items: analysis.order.items as unknown as Prisma.InputJsonValue,
        deliveryLocation: analysis.order.deliveryLocation,
        totalGhs: analysis.order.totalGhs,
      };
      await tx.order.upsert({
        where: { conversationId: convo.id },
        create: { workspaceId, conversationId: convo.id, contactId: convo.contactId, ...data },
        update: data,
      });
    }
    if (analysis.isBusiness && analysis.reply) {
      // One live suggestion per chat: a newer message makes the older draft stale.
      await tx.draft.updateMany({
        where: { conversationId: convo.id, status: "PENDING" },
        data: { status: "REJECTED", reason: "Replaced by a newer draft", decidedAt: new Date() },
      });
      await tx.draft.create({
        data: { workspaceId, conversationId: convo.id, body: analysis.reply, kind: opts.followUp ? "FOLLOW_UP" : "REPLY" },
      });
    }
  });

  return analysis.isBusiness && analysis.reply ? "drafted" : "triaged";
}

const STAGES = ["NEW", "NEGOTIATING", "ORDERED", "PAID", "DELIVERED"] as const;
function stageRank(stage: string): number {
  return stage === "LOST" ? -1 : STAGES.indexOf(stage as (typeof STAGES)[number]);
}

/**
 * New messages often arrive in bursts ("hello" / "pls" / "how much is the
 * bag"). Waiting a few seconds lets one AI pass see the whole burst.
 */
const pending = new Map<string, NodeJS.Timeout>();
export function scheduleTriage(conversationId: string, delayMs = 15_000) {
  clearTimeout(pending.get(conversationId));
  pending.set(
    conversationId,
    setTimeout(() => {
      pending.delete(conversationId);
      triageConversation(conversationId).catch((err) => console.error(`[triage] ${conversationId}`, err));
    }, delayMs),
  );
}

/** "Scan my chats": triage every conversation that changed since its last pass, newest first, until the quota runs out. */
export async function scanWorkspace(workspaceId: string, max = 200) {
  const convos = await prisma.conversation.findMany({
    where: { workspaceId, needsTriage: true },
    orderBy: { lastMessageAt: "desc" },
    take: max,
    select: { id: true },
  });
  const tally: Record<TriageOutcome, number> = { triaged: 0, drafted: 0, quota: 0, inactive: 0, ai_off: 0, empty: 0 };
  for (const c of convos) {
    const outcome = await triageConversation(c.id);
    tally[outcome]++;
    if (outcome === "quota" || outcome === "inactive" || outcome === "ai_off") break;
  }
  return { considered: convos.length, ...tally };
}
