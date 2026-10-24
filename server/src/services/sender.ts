import { prisma } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { waLink } from "../lib/phone.js";
import { SERVICE_WINDOW_MS, sendTemplate, sendText } from "../lib/whatsapp.js";

export async function cloudConnection(workspaceId: string) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { workspaceId } });
  if (!conn || conn.mode !== "CLOUD" || !conn.accessTokenEnc || !conn.phoneNumberId) return null;
  return { conn, token: decrypt(conn.accessTokenEnc), phoneNumberId: conn.phoneNumberId };
}

export function windowOpen(lastInboundAt: Date | null, now = Date.now()): boolean {
  return !!lastInboundAt && now - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

export type SendResult = { route: "api"; messageId: string } | { route: "link"; url: string };

/**
 * Sends a free-form reply in a conversation.
 *
 * With a Cloud API connection it goes straight out, provided the 24-hour
 * window is still open. The window is re-read now, not trusted from when the
 * draft was written, because it may have closed since. Without a connection,
 * it returns a wa.me link the seller opens and sends from their own phone.
 */
export async function sendReply(input: {
  workspaceId: string;
  conversationId: string;
  body: string;
  userId?: string;
  autoRuleId?: string;
}): Promise<SendResult> {
  const body = input.body.trim();
  if (!body) throw new HttpError(400, "The message is empty.");
  if (body.length > 4096) throw new HttpError(400, "WhatsApp messages can be at most 4,096 characters.");

  const convo = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    include: { contact: true },
  });
  if (!convo) throw new HttpError(404, "Conversation not found.");

  const cloud = await cloudConnection(input.workspaceId);
  if (!cloud) return { route: "link", url: waLink(convo.contact.phone, body) };

  if (!windowOpen(convo.lastInboundAt)) {
    throw new HttpError(
      409,
      "It's been more than 24 hours since this customer last messaged you. WhatsApp only allows an approved template now: send one from Broadcasts, or open the chat on your phone.",
      "window_closed",
    );
  }

  const message = await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: "OUTBOUND",
      body,
      status: "QUEUED",
      sentByUserId: input.userId,
      autoRuleId: input.autoRuleId,
    },
  });
  try {
    const waMessageId = await sendText(cloud.token, cloud.phoneNumberId, convo.contact.phone, body);
    await prisma.message.update({ where: { id: message.id }, data: { waMessageId, status: "SENT" } });
  } catch (err) {
    await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED", error: (err as Error).message } });
    throw err;
  }
  await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date(), unread: 0 } });
  return { route: "api", messageId: message.id };
}

/** Sends an approved template to one contact and records it in their conversation. */
export async function sendTemplateTo(input: {
  workspaceId: string;
  contactId: string;
  template: { name: string; language: string; bodyParams: string[] };
  preview: string;
}): Promise<string> {
  const cloud = await cloudConnection(input.workspaceId);
  if (!cloud) throw new HttpError(409, "Templates need a WhatsApp Cloud API connection. Connect WhatsApp in Settings.");
  const contact = await prisma.contact.findFirstOrThrow({ where: { id: input.contactId, workspaceId: input.workspaceId } });
  const waMessageId = await sendTemplate(cloud.token, cloud.phoneNumberId, contact.phone, input.template);
  const convo = await prisma.conversation.upsert({
    where: { workspaceId_contactId: { workspaceId: input.workspaceId, contactId: contact.id } },
    create: { workspaceId: input.workspaceId, contactId: contact.id, lastMessageAt: new Date(), needsTriage: false },
    update: { lastMessageAt: new Date() },
  });
  await prisma.message.create({
    data: { conversationId: convo.id, direction: "OUTBOUND", type: "template", body: input.preview, waMessageId, status: "SENT" },
  });
  return waMessageId;
}
