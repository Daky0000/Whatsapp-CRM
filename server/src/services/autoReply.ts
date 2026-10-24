import type { AutoReplyRule } from "@prisma/client";
import { prisma } from "../db.js";
import { sendReply } from "./sender.js";

const AWAY_COOLDOWN_MS = 12 * 3_600_000;
const KEYWORD_COOLDOWN_MS = 3_600_000;

/** "HH:MM" in Accra (UTC+0, no daylight saving) → minutes since midnight. */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isOutsideHours(open: string, close: string, now = new Date()): boolean {
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  const o = minutes(open);
  const c = minutes(close);
  return o <= c ? t < o || t >= c : t >= c && t < o; // handles overnight hours like 18:00–02:00
}

export function keywordMatches(rule: Pick<AutoReplyRule, "keywords">, text: string): boolean {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ")} `;
  return rule.keywords.some((k) => k.trim() && haystack.includes(` ${k.trim().toLowerCase()} `));
}

/**
 * Picks at most one automatic reply for an inbound message. Order: WELCOME
 * (first ever message), then a KEYWORD match, then AWAY (outside business
 * hours). Cooldowns stop a chatty customer from receiving the same canned
 * text over and over. Only called for Cloud API connections: without one,
 * nothing can be sent automatically.
 */
export async function runAutoReplies(input: {
  workspaceId: string;
  conversationId: string;
  text: string;
  isFirstMessage: boolean;
}): Promise<void> {
  const [rules, workspace] = await Promise.all([
    prisma.autoReplyRule.findMany({ where: { workspaceId: input.workspaceId, active: true } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { hoursOpen: true, hoursClose: true } }),
  ]);
  if (!rules.length) return;

  const recentlySent = async (ruleId: string, withinMs: number) =>
    !!(await prisma.message.findFirst({
      where: { conversationId: input.conversationId, autoRuleId: ruleId, timestamp: { gte: new Date(Date.now() - withinMs) } },
      select: { id: true },
    }));

  let chosen: AutoReplyRule | undefined;
  if (input.isFirstMessage) chosen = rules.find((r) => r.trigger === "WELCOME");
  if (!chosen) {
    for (const rule of rules.filter((r) => r.trigger === "KEYWORD")) {
      if (keywordMatches(rule, input.text) && !(await recentlySent(rule.id, KEYWORD_COOLDOWN_MS))) {
        chosen = rule;
        break;
      }
    }
  }
  if (!chosen && isOutsideHours(workspace.hoursOpen, workspace.hoursClose)) {
    const away = rules.find((r) => r.trigger === "AWAY");
    if (away && !(await recentlySent(away.id, AWAY_COOLDOWN_MS))) chosen = away;
  }
  if (!chosen) return;

  await sendReply({ workspaceId: input.workspaceId, conversationId: input.conversationId, body: chosen.reply, autoRuleId: chosen.id });
}
