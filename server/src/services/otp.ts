import type { OtpChannel } from "@prisma/client";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";
import { normalizePhone } from "../lib/phone.js";
import { OTP_EXPIRY_MINUTES, OTP_LENGTH, vynfyConfigured, vynfySendOtp, vynfyVerifyOtp } from "../lib/vynfy.js";
import { sendAuthCode } from "../lib/whatsapp.js";

/**
 * One-time codes for sign-up and password resets, over three channels:
 *
 *  - SMS and VOICE through Vynfy (lib/vynfy.ts), which holds the code itself.
 *  - WHATSAPP through DakyXTech's own number, using the OS's settings
 *    (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID) and an approved AUTHENTICATION
 *    template named by WHATSAPP_OTP_TEMPLATE. Vynfy can't deliver WhatsApp, and
 *    can't check a code it didn't make, so for this channel we generate the
 *    code and keep only an HMAC of it, with the same 5 minutes and 3 attempts.
 *
 * The OtpChallenge row binds a code to its purpose, so a code requested to
 * reset a password can't be used to sign up, or the other way round.
 */
export type Purpose = "signup" | "reset";
const MAX_ATTEMPTS = 3;

function whatsappOtpConfig() {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const template = process.env.WHATSAPP_OTP_TEMPLATE?.trim();
  if (!token || !phoneNumberId || !template) return null;
  return { token, phoneNumberId, template: { name: template, language: process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "en" } };
}

export function otpChannels(): Record<OtpChannel, boolean> {
  const vynfy = vynfyConfigured();
  return { SMS: vynfy, VOICE: vynfy, WHATSAPP: whatsappOtpConfig() !== null };
}

export const anyOtpChannel = () => Object.values(otpChannels()).some(Boolean);

function hashCode(phone: string, purpose: Purpose, code: string): string {
  return createHmac("sha256", config.sessionSecret()).update(`${phone}|${purpose}|${code}`).digest("hex");
}

export async function sendCode(rawPhone: string, purpose: Purpose, channel: OtpChannel): Promise<{ channel: OtpChannel; ussdCode?: string }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new HttpError(400, "Enter a valid phone number, e.g. 024 123 4567.");
  if (!otpChannels()[channel]) throw new HttpError(400, "That way of receiving codes isn't available. Try SMS.");

  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);
  if (channel === "WHATSAPP") {
    const wa = whatsappOtpConfig()!;
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
    const codeHash = hashCode(phone, purpose, code);
    await prisma.otpChallenge.upsert({
      where: { phone_purpose: { phone, purpose } },
      create: { phone, purpose, channel, codeHash, expiresAt },
      update: { channel, codeHash, expiresAt, attempts: 0, createdAt: new Date() },
    });
    await sendAuthCode(wa.token, wa.phoneNumberId, phone, wa.template, code).catch((err) => {
      throw new HttpError(502, `We couldn't send the code on WhatsApp (${(err as Error).message}). Try SMS instead.`);
    });
    return { channel };
  }

  const result = await vynfySendOtp(phone, channel === "VOICE" ? "voice" : "sms");
  if (!result.ok) throw new HttpError(result.fatal ? 400 : 502, result.message, result.code);
  await prisma.otpChallenge.upsert({
    where: { phone_purpose: { phone, purpose } },
    create: { phone, purpose, channel, expiresAt },
    update: { channel, codeHash: null, expiresAt, attempts: 0, createdAt: new Date() },
  });
  return { channel, ussdCode: result.ussdCode };
}

/** Throws a 400 with a sentence the person can act on; returns the normalised phone when the code is right. */
export async function checkCode(rawPhone: string, purpose: Purpose, code: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new HttpError(400, "Enter a valid phone number.");
  if (!/^\d{4,8}$/.test(code.trim())) throw new HttpError(400, "Enter the code we sent you.");
  const challenge = await prisma.otpChallenge.findUnique({ where: { phone_purpose: { phone, purpose } } });
  if (!challenge || challenge.expiresAt < new Date()) throw new HttpError(400, "That code has expired. Ask for a new one.", "otp_expired");

  if (challenge.channel === "WHATSAPP") {
    if (challenge.attempts >= MAX_ATTEMPTS) throw new HttpError(400, "Too many wrong tries. Ask for a new code.", "otp_expired");
    const expected = Buffer.from(challenge.codeHash ?? "", "hex");
    const actual = Buffer.from(hashCode(phone, purpose, code.trim()), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const { attempts } = await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      const left = MAX_ATTEMPTS - attempts;
      throw new HttpError(400, left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong tries. Ask for a new code.", "otp_invalid");
    }
  } else {
    const result = await vynfyVerifyOtp(phone, code);
    if (!result.ok) throw new HttpError(400, result.message, result.code);
  }

  await prisma.otpChallenge.delete({ where: { id: challenge.id } });
  return phone;
}
