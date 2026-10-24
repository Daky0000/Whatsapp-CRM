import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { transcribe, transcriptionConfigured } from "../lib/transcribe.js";
import { downloadMedia } from "../lib/whatsapp.js";
import { cloudConnection } from "./sender.js";
import { assertActive, consume, METRIC, usageCount } from "./usage.js";

export type VoiceOutcome = "transcribed" | "not_on_plan" | "minutes_used" | "off" | "not_audio";

/**
 * Transcribes one voice note. The plan's minutes are checked before the call
 * and charged with the real length after it, so a long final note can run a
 * little past the allowance; that's fair use, not a hole worth more code.
 */
export async function transcribeMessage(messageId: string): Promise<VoiceOutcome> {
  if (!transcriptionConfigured()) return "off";
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { select: { workspaceId: true } } } });
  if (!message || message.type !== "audio" || !message.mediaId) return "not_audio";
  if (message.transcript !== null) return "transcribed";
  const workspaceId = message.conversation.workspaceId;

  const limits = await assertActive(workspaceId).catch(() => null);
  if (!limits?.transcriptionMinutes) return "not_on_plan";
  if ((await usageCount(workspaceId, METRIC.TRANSCRIPTION_SECONDS)) >= limits.transcriptionMinutes * 60) return "minutes_used";

  const cloud = await cloudConnection(workspaceId);
  if (!cloud) throw new HttpError(409, "Voice notes need a WhatsApp Cloud API connection.");
  const media = await downloadMedia(cloud.token, message.mediaId);
  const result = await transcribe(media.body, media.contentType);
  await prisma.message.update({ where: { id: message.id }, data: { transcript: result.text, audioSeconds: result.seconds } });
  await consume(workspaceId, METRIC.TRANSCRIPTION_SECONDS, Infinity, result.seconds);
  return "transcribed";
}
