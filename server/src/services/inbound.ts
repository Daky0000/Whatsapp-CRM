import type { Direction } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { limitsFor } from "../lib/plans.js";
import { normalizePhone } from "../lib/phone.js";
import { runAutoReplies } from "./autoReply.js";
import { scheduleTriage } from "./triage.js";

/**
 * Everything that arrives from Meta's webhook ends up here: live customer
 * messages, delivery statuses, messages the seller typed in their phone app
 * (Coexistence "echoes"), and the one-time history and contact sync.
 */

interface WaMessage {
  from?: string;
  to?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string; filename?: string };
  audio?: { id?: string; voice?: boolean };
  sticker?: { id?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  reaction?: { emoji?: string };
}

export function messageText(m: WaMessage): { body: string | null; mediaId: string | null } {
  switch (m.type) {
    case "text":
      return { body: m.text?.body ?? null, mediaId: null };
    case "image":
    case "video":
      return { body: m[m.type]?.caption ?? null, mediaId: m[m.type]?.id ?? null };
    case "document":
      return { body: m.document?.caption ?? m.document?.filename ?? null, mediaId: m.document?.id ?? null };
    case "audio":
      return { body: null, mediaId: m.audio?.id ?? null };
    case "sticker":
      return { body: null, mediaId: m.sticker?.id ?? null };
    case "button":
      return { body: m.button?.text ?? null, mediaId: null };
    case "interactive":
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null, mediaId: null };
    case "location": {
      const l = m.location;
      return { body: l ? `📍 ${[l.name, l.address].filter(Boolean).join(", ") || `${l.latitude}, ${l.longitude}`}` : null, mediaId: null };
    }
    case "reaction":
      return { body: m.reaction?.emoji ?? null, mediaId: null };
    default:
      return { body: null, mediaId: null };
  }
}

const STOP = /^\s*(stop|unsubscribe|stop all|opt out|cancel)\s*[.!]*\s*$/i;
const START = /^\s*(start|subscribe|unstop)\s*[.!]*\s*$/i;

export interface RecordInput {
  workspaceId: string;
  phone: string;
  direction: Direction;
  waMessageId?: string | null;
  type: string;
  body: string | null;
  mediaId?: string | null;
  timestamp: Date;
  profileName?: string | null;
  source: "live" | "history" | "import";
  origin?: "api" | "app";
}

/**
 * Stores one message and keeps the contact and conversation in step. Returns
 * null when the message was already stored (Meta redelivers webhooks) or when
 * the history-sync limits of the plan say to skip it.
 */
export async function recordMessage(input: RecordInput) {
  const phone = normalizePhone(input.phone.startsWith("+") ? input.phone : `+${input.phone}`);
  if (!phone) return null;
  if (input.waMessageId && (await prisma.message.findUnique({ where: { waMessageId: input.waMessageId }, select: { id: true } }))) {
    return null;
  }

  const contact = await prisma.contact.upsert({
    where: { workspaceId_phone: { workspaceId: input.workspaceId, phone } },
    create: { workspaceId: input.workspaceId, phone, name: input.profileName ?? null },
    update: {},
  });
  if (input.profileName && !contact.name) {
    await prisma.contact.update({ where: { id: contact.id }, data: { name: input.profileName } });
  }

  let convo = await prisma.conversation.findUnique({
    where: { workspaceId_contactId: { workspaceId: input.workspaceId, contactId: contact.id } },
  });
  const isFirstMessage = !convo;
  if (!convo) {
    convo = await prisma.conversation.create({
      data: { workspaceId: input.workspaceId, contactId: contact.id, source: input.source },
    });
  }

  const inbound = input.direction === "INBOUND";
  try {
    await prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: input.direction,
        type: input.type,
        body: input.body,
        mediaId: input.mediaId ?? null,
        waMessageId: input.waMessageId ?? null,
        status: inbound ? "RECEIVED" : "SENT",
        origin: input.origin ?? "api",
        timestamp: input.timestamp,
      },
    });
  } catch (err) {
    // Two deliveries of the same webhook racing each other: the unique index decides.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }

  const newer = !convo.lastMessageAt || input.timestamp > convo.lastMessageAt;
  convo = await prisma.conversation.update({
    where: { id: convo.id },
    data: {
      lastMessageAt: newer ? input.timestamp : undefined,
      lastInboundAt: inbound && (!convo.lastInboundAt || input.timestamp > convo.lastInboundAt) ? input.timestamp : undefined,
      unread: inbound && input.source === "live" ? { increment: 1 } : undefined,
      needsTriage: true,
    },
  });

  if (inbound && input.body) {
    if (STOP.test(input.body)) await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: true, optedIn: false } });
    else if (START.test(input.body)) await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: false, optedIn: true } });
  }

  return { contact, conversation: convo, isFirstMessage };
}

interface ChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WaMessage[];
  message_echoes?: WaMessage[];
  statuses?: Array<{ id: string; status: string; errors?: Array<{ code?: number; title?: string; message?: string }> }>;
  history?: Array<{ threads?: Array<{ id?: string; messages?: Array<WaMessage & { history_context?: { status?: string } }> }> }>;
  state_sync?: Array<{ type?: string; action?: string; contact?: { full_name?: string; first_name?: string; phone_number?: string } }>;
}

export interface WebhookPayload {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: ChangeValue }> }>;
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function handleWebhook(payload: WebhookPayload): Promise<void> {
  if (payload.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { phoneNumberId },
        include: { workspace: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } } },
      });
      if (!conn) continue;
      const workspaceId = conn.workspaceId;
      const businessPhone = normalizePhone(`+${value.metadata?.display_phone_number ?? ""}`);

      switch (change.field) {
        case "messages":
          await handleLiveMessages(workspaceId, value);
          break;
        case "smb_message_echoes":
          for (const m of value.message_echoes ?? []) {
            if (!m.to) continue;
            const { body, mediaId } = messageText(m);
            await recordMessage({
              workspaceId, phone: m.to, direction: "OUTBOUND", waMessageId: m.id, type: m.type, body, mediaId,
              timestamp: new Date(Number(m.timestamp) * 1000), source: "live", origin: "app",
            });
          }
          break;
        case "history":
          await handleHistory(workspaceId, businessPhone, value, limitsFor(conn.workspace));
          await prisma.whatsAppConnection.update({ where: { id: conn.id }, data: { historySyncedAt: new Date() } });
          break;
        case "smb_app_state_sync":
          for (const s of value.state_sync ?? []) {
            const phone = s.contact?.phone_number && normalizePhone(`+${s.contact.phone_number.replace(/^\+/, "")}`);
            if (s.type !== "contact" || !phone || s.action === "remove") continue;
            const name = s.contact?.full_name || s.contact?.first_name || null;
            await prisma.contact.upsert({
              where: { workspaceId_phone: { workspaceId, phone } },
              create: { workspaceId, phone, name },
              update: name ? { name } : {},
            });
          }
          break;
      }
    }
  }
}

async function handleLiveMessages(workspaceId: string, value: ChangeValue) {
  for (const s of value.statuses ?? []) {
    const status = STATUS_MAP[s.status];
    if (!status) continue;
    const error = s.errors?.[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : undefined;
    await prisma.message.updateMany({ where: { waMessageId: s.id }, data: { status, error } });
    await prisma.broadcastRecipient.updateMany({ where: { waMessageId: s.id }, data: { status, error } });
  }

  const cloudReady = await prisma.whatsAppConnection.count({ where: { workspaceId, mode: "CLOUD" } });
  for (const m of value.messages ?? []) {
    if (!m.from) continue;
    const profileName = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
    const { body, mediaId } = messageText(m);
    const recorded = await recordMessage({
      workspaceId, phone: m.from, direction: "INBOUND", waMessageId: m.id, type: m.type, body, mediaId,
      timestamp: new Date(Number(m.timestamp) * 1000), profileName, source: "live",
    });
    if (!recorded) continue;
    if (cloudReady && body && !STOP.test(body)) {
      await runAutoReplies({
        workspaceId, conversationId: recorded.conversation.id, text: body, isFirstMessage: recorded.isFirstMessage,
      }).catch((err) => console.warn(`[auto-reply] ${recorded.conversation.id}: ${(err as Error).message}`));
    }
    if (recorded.conversation.category !== "NOT_BUSINESS" || recorded.isFirstMessage) scheduleTriage(recorded.conversation.id);
  }
}

async function handleHistory(
  workspaceId: string,
  businessPhone: string | null,
  value: ChangeValue,
  limits: { historyDays: number; historyChats: number },
) {
  const cutoff = Date.now() - limits.historyDays * 86_400_000;
  let imported = await prisma.conversation.count({ where: { workspaceId, source: "history" } });
  for (const chunk of value.history ?? []) {
    for (const thread of chunk.threads ?? []) {
      if (!thread.id) continue;
      const customer = normalizePhone(`+${thread.id}`);
      if (!customer) continue;
      const contact = await prisma.contact.findUnique({ where: { workspaceId_phone: { workspaceId, phone: customer } } });
      const exists = contact && (await prisma.conversation.count({ where: { workspaceId, contactId: contact.id } }));
      if (!exists && imported >= limits.historyChats) continue;
      let wrote = false;
      for (const m of thread.messages ?? []) {
        const at = Number(m.timestamp) * 1000;
        if (at < cutoff) continue;
        const outbound = !!businessPhone && normalizePhone(`+${m.from ?? ""}`) === businessPhone;
        const { body, mediaId } = messageText(m);
        const r = await recordMessage({
          workspaceId, phone: customer, direction: outbound ? "OUTBOUND" : "INBOUND", waMessageId: m.id, type: m.type, body, mediaId,
          timestamp: new Date(at), source: "history", origin: outbound ? "app" : "api",
        });
        wrote ||= !!r;
      }
      if (wrote && !exists) imported++;
    }
  }
}
