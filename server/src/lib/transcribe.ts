import { HttpError } from "./errors.js";

/**
 * Speech-to-text for WhatsApp voice notes. Claude doesn't take audio, so a
 * dedicated provider turns the note into text and the AI reads that.
 *
 *   TRANSCRIBE_PROVIDER=deepgram (default) | openai
 *   TRANSCRIBE_API_KEY=...
 *   TRANSCRIBE_BASE_URL=...   optional: an OpenAI-compatible Whisper server you host, or a test stand-in
 *
 * Twi, Ga and Ewe are poorly covered by every provider today; English and
 * Ghanaian Pidgin come out usable. A transcript is a reading aid for the
 * seller and the AI, never something sent to the customer.
 */
export interface Transcript {
  text: string;
  seconds: number;
}

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.TRANSCRIBE_API_KEY);
}

export async function transcribe(audio: ArrayBuffer, contentType: string): Promise<Transcript> {
  const key = process.env.TRANSCRIBE_API_KEY;
  if (!key) throw new HttpError(503, "Voice-note transcription isn't switched on for this server.");
  const provider = (process.env.TRANSCRIBE_PROVIDER ?? "deepgram").toLowerCase();
  return provider === "openai" ? openai(key, audio, contentType) : deepgram(key, audio, contentType);
}

async function deepgram(key: string, audio: ArrayBuffer, contentType: string): Promise<Transcript> {
  const url = `${process.env.TRANSCRIBE_BASE_URL ?? "https://api.deepgram.com"}/v1/listen?model=nova-3&smart_format=true&detect_language=true`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": contentType.split(";")[0]! },
    body: audio,
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!response?.ok) throw new HttpError(502, `Transcription failed${response ? ` (${response.status})` : ""}.`);
  const data = (await response.json()) as {
    metadata?: { duration?: number };
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  return {
    text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "",
    seconds: Math.ceil(data.metadata?.duration ?? 0),
  };
}

async function openai(key: string, audio: ArrayBuffer, contentType: string): Promise<Transcript> {
  const form = new FormData();
  // WhatsApp voice notes are OGG/Opus; the filename extension is how Whisper picks the decoder.
  const ext = contentType.includes("ogg") ? "ogg" : contentType.includes("mpeg") ? "mp3" : contentType.includes("mp4") ? "m4a" : "ogg";
  form.append("file", new Blob([audio], { type: contentType }), `voice.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const response = await fetch(`${process.env.TRANSCRIBE_BASE_URL ?? "https://api.openai.com"}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!response?.ok) throw new HttpError(502, `Transcription failed${response ? ` (${response.status})` : ""}.`);
  const data = (await response.json()) as { text?: string; duration?: number };
  return { text: data.text?.trim() ?? "", seconds: Math.ceil(data.duration ?? 0) };
}
