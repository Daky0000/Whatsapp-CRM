import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { requireOwner, ws } from "../lib/auth.js";
import { encrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { normalizePhone } from "../lib/phone.js";
import {
  downloadMedia,
  exchangeSignupCode,
  listTemplates,
  phoneNumberInfo,
  requestCoexistenceSync,
  subscribeApp,
} from "../lib/whatsapp.js";
import { cloudConnection } from "../services/sender.js";

export const whatsappRouter = Router();

whatsappRouter.get(
  "/whatsapp/config",
  h(async (_req, res) => {
    // Public values for Meta's Embedded Signup in the browser. The app secret never leaves the server.
    res.json({
      appId: config.meta.appId || null,
      configId: config.meta.configId || null,
      graphVersion: config.meta.graphVersion,
      embeddedSignupReady: Boolean(config.meta.appId && config.meta.configId && config.meta.appSecret),
    });
  }),
);

async function saveCloudConnection(workspaceId: string, input: { token: string; phoneNumberId: string; wabaId: string; coexistence: boolean }) {
  const info = await phoneNumberInfo(input.token, input.phoneNumberId);
  const taken = await prisma.whatsAppConnection.findUnique({ where: { phoneNumberId: input.phoneNumberId } });
  if (taken && taken.workspaceId !== workspaceId) throw new HttpError(409, "This WhatsApp number is already connected to another account.");
  const data = {
    mode: "CLOUD" as const,
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    accessTokenEnc: encrypt(input.token),
    displayPhone: info.display_phone_number ?? null,
    verifiedName: info.verified_name ?? null,
    coexistence: input.coexistence,
  };
  return prisma.whatsAppConnection.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
}

const Signup = z.object({
  code: z.string().min(10),
  phoneNumberId: z.string().regex(/^\d+$/),
  wabaId: z.string().regex(/^\d+$/),
  /** Embedded Signup reports FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING for a Business-app (Coexistence) number. */
  coexistence: z.boolean().default(true),
});

whatsappRouter.post(
  "/whatsapp/embedded-signup",
  requireOwner,
  h(async (req, res) => {
    const body = parse(Signup, req.body);
    const token = await exchangeSignupCode(body.code);
    await subscribeApp(token, body.wabaId);
    const conn = await saveCloudConnection(ws(req), { token, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId, coexistence: body.coexistence });
    let historyRequested = false;
    if (body.coexistence) {
      historyRequested = await requestCoexistenceSync(token, body.phoneNumberId).then(
        () => true,
        (err) => (console.warn(`[coexistence] sync request failed: ${(err as Error).message}`), false),
      );
    }
    res.json({ ok: true, displayPhone: conn.displayPhone, historyRequested });
  }),
);

const Manual = z.object({
  accessToken: z.string().min(20),
  phoneNumberId: z.string().regex(/^\d+$/),
  wabaId: z.string().regex(/^\d+$/),
});

/** For testing with Meta's test number, or a number already set up through a BSP. */
whatsappRouter.post(
  "/whatsapp/manual",
  requireOwner,
  h(async (req, res) => {
    const body = parse(Manual, req.body);
    const conn = await saveCloudConnection(ws(req), { token: body.accessToken, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId, coexistence: false });
    await subscribeApp(body.accessToken, body.wabaId).catch((err) => console.warn(`[whatsapp] subscribe failed: ${(err as Error).message}`));
    res.json({ ok: true, displayPhone: conn.displayPhone });
  }),
);

const ImportMode = z.object({ displayPhone: z.string().optional() });

/** No API yet: chats come in as exports and replies go out as wa.me links. */
whatsappRouter.post(
  "/whatsapp/import-mode",
  requireOwner,
  h(async (req, res) => {
    const body = parse(ImportMode, req.body);
    const phone = body.displayPhone ? normalizePhone(body.displayPhone) : null;
    const data = { mode: "IMPORT" as const, displayPhone: phone ? `+${phone}` : null, phoneNumberId: null, wabaId: null, accessTokenEnc: null, coexistence: false };
    await prisma.whatsAppConnection.upsert({ where: { workspaceId: ws(req) }, create: { workspaceId: ws(req), ...data }, update: data });
    res.json({ ok: true });
  }),
);

whatsappRouter.delete(
  "/whatsapp",
  requireOwner,
  h(async (req, res) => {
    await prisma.whatsAppConnection.deleteMany({ where: { workspaceId: ws(req) } });
    res.json({ ok: true });
  }),
);

whatsappRouter.get(
  "/whatsapp/templates",
  h(async (req, res) => {
    const cloud = await cloudConnection(ws(req));
    if (!cloud?.conn.wabaId) return res.json({ templates: [], connected: false });
    const templates = await listTemplates(cloud.token, cloud.conn.wabaId);
    res.json({ templates: templates.filter((t) => t.status === "APPROVED"), connected: true });
  }),
);

/** Streams a voice note, image or document from Meta; the browser can't fetch it without our token. */
whatsappRouter.get(
  "/media/:messageId",
  h(async (req, res) => {
    const message = await prisma.message.findFirst({
      where: { id: param(req, "messageId"), conversation: { workspaceId: ws(req) } },
      select: { mediaId: true },
    });
    if (!message?.mediaId) throw new HttpError(404, "No media on that message.");
    const cloud = await cloudConnection(ws(req));
    if (!cloud) throw new HttpError(409, "Media needs a WhatsApp Cloud API connection.");
    const media = await downloadMedia(cloud.token, message.mediaId);
    res.setHeader("content-type", media.contentType);
    res.setHeader("cache-control", "private, max-age=3600");
    res.send(Buffer.from(media.body));
  }),
);
