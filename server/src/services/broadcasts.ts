import { prisma } from "../db.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { assertActive, consume, METRIC, release, usageCount } from "./usage.js";
import { debitWallet, creditWallet } from "./wallet.js";
import { sendTemplateTo } from "./sender.js";

/** Who a broadcast would reach: list members who have not opted out. */
export async function recipientsFor(workspaceId: string, listId: string) {
  return prisma.contact.findMany({
    where: { workspaceId, optedOut: false, listMembers: { some: { listId } } },
    select: { id: true, name: true, phone: true, optedIn: true },
  });
}

/** Free credits left this month, then the wallet pays for the rest. */
export async function quote(workspaceId: string, recipientCount: number) {
  const limits = await assertActive(workspaceId);
  const freeUsed = await usageCount(workspaceId, METRIC.FREE_BROADCAST);
  const free = Math.max(0, Math.min(recipientCount, limits.freeBroadcastCredits - freeUsed));
  const paid = recipientCount - free;
  const sentThisMonth = await usageCount(workspaceId, METRIC.BROADCAST_RECIPIENTS);
  return {
    recipients: recipientCount,
    free,
    paid,
    costPesewas: paid * config.meta.marketingPesewas,
    monthlyLimit: limits.broadcastRecipientsPerMonth,
    remainingThisMonth: Math.max(0, limits.broadcastRecipientsPerMonth - sentThisMonth),
  };
}

function fill(variables: string[], contact: { name: string | null }): string[] {
  const first = contact.name?.split(/\s+/)[0] || "there";
  return variables.map((v) => v.replaceAll("{{name}}", first));
}

const SEND_GAP_MS = 120; // well under Meta's per-number throughput

/**
 * Sends a broadcast now. Charges the wallet up front for the paid share,
 * refunds whatever fails, and records each recipient's outcome. Delivery and
 * read receipts arrive later through the webhook.
 */
export async function sendBroadcast(workspaceId: string, broadcastId: string): Promise<void> {
  const claimed = await prisma.broadcast.updateMany({
    where: { id: broadcastId, workspaceId, status: { in: ["DRAFT", "SCHEDULED"] } },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) throw new HttpError(409, "This broadcast has already been sent or cancelled.");
  const broadcast = await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
  let charged = false;

  try {
    if (!broadcast.listId) throw new HttpError(400, "Choose a broadcast list first.");
    const contacts = await recipientsFor(workspaceId, broadcast.listId);
    if (!contacts.length) throw new HttpError(400, "Nobody on this list can receive broadcasts (empty, or everyone opted out).");
    const q = await quote(workspaceId, contacts.length);
    const limits = await assertActive(workspaceId);
    if (!(await consume(workspaceId, METRIC.BROADCAST_RECIPIENTS, limits.broadcastRecipientsPerMonth, contacts.length))) {
      throw new HttpError(402, `This would pass your plan's ${limits.broadcastRecipientsPerMonth} broadcast recipients this month (${q.remainingThisMonth} left).`);
    }
    if (q.free && !(await consume(workspaceId, METRIC.FREE_BROADCAST, limits.freeBroadcastCredits, q.free))) {
      await release(workspaceId, METRIC.BROADCAST_RECIPIENTS, contacts.length);
      throw new HttpError(409, "Your free credits changed while sending. Please try again.");
    }
    try {
      await debitWallet(workspaceId, q.costPesewas, `Broadcast “${broadcast.name}” (${q.paid} paid messages)`);
    } catch (err) {
      await release(workspaceId, METRIC.BROADCAST_RECIPIENTS, contacts.length);
      if (q.free) await release(workspaceId, METRIC.FREE_BROADCAST, q.free);
      throw err;
    }

    charged = true;

    await prisma.broadcastRecipient.createMany({
      data: contacts.map((c) => ({ broadcastId, contactId: c.id })),
      skipDuplicates: true,
    });

    let failed = 0;
    for (const contact of contacts) {
      const params = fill(broadcast.variables, contact);
      try {
        const waMessageId = await sendTemplateTo({
          workspaceId,
          contactId: contact.id,
          template: { name: broadcast.templateName, language: broadcast.templateLang, bodyParams: params },
          preview: `[Template ${broadcast.templateName}] ${params.join(" · ")}`,
        });
        await prisma.broadcastRecipient.update({
          where: { broadcastId_contactId: { broadcastId, contactId: contact.id } },
          data: { status: "SENT", waMessageId },
        });
      } catch (err) {
        failed++;
        await prisma.broadcastRecipient.update({
          where: { broadcastId_contactId: { broadcastId, contactId: contact.id } },
          data: { status: "FAILED", error: (err as Error).message.slice(0, 500) },
        });
      }
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }

    // Free credits are used first, so a failure refunds a paid message while there were any.
    const refundable = Math.min(failed, q.paid);
    if (refundable) await creditWallet(workspaceId, refundable * config.meta.marketingPesewas, `Refund: ${refundable} undelivered in “${broadcast.name}”`);
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: failed === contacts.length ? "FAILED" : "SENT",
        sentAt: new Date(),
        costPesewas: q.costPesewas - refundable * config.meta.marketingPesewas,
      },
    });
  } catch (err) {
    // Refused before anything was charged or sent (empty list, limit, wallet): back to an editable draft.
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: charged ? "FAILED" : "DRAFT" },
    });
    throw err;
  }
}
