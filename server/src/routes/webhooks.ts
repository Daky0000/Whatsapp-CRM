import express, { Router } from "express";
import { config } from "../config.js";
import { verifyPaystackSignature } from "../lib/paystack.js";
import { verifyMetaSignature } from "../lib/whatsapp.js";
import { handlePaystackEvent } from "../services/billing.js";
import { handleWebhook, type WebhookPayload } from "../services/inbound.js";

/**
 * Public webhook endpoints, mounted ABOVE the JSON body parser: both Meta and
 * Paystack sign the exact bytes they sent, and a re-serialised body would fail
 * the check. An unverified WhatsApp webhook would let anyone open a 24-hour
 * window to a number of their choosing, so nothing is processed unsigned.
 */
export const webhooksRouter = Router();
const raw = express.raw({ type: "*/*", limit: "5mb" });

webhooksRouter.get("/whatsapp", (req, res) => {
  const ok = req.query["hub.mode"] === "subscribe" && config.meta.verifyToken && req.query["hub.verify_token"] === config.meta.verifyToken;
  if (!ok) return res.sendStatus(403);
  res.status(200).send(String(req.query["hub.challenge"] ?? ""));
});

webhooksRouter.post("/whatsapp", raw, (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !verifyMetaSignature(body, req.header("x-hub-signature-256"))) return res.sendStatus(401);
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body.toString("utf8")) as WebhookPayload;
  } catch {
    return res.sendStatus(400);
  }
  // Answer at once: Meta retries anything slower than a few seconds, and redelivery is deduplicated anyway.
  res.sendStatus(200);
  handleWebhook(payload).catch((err) => console.error("[webhook:whatsapp]", err));
});

webhooksRouter.post("/paystack", raw, (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !verifyPaystackSignature(body, req.header("x-paystack-signature"))) return res.sendStatus(401);
  let evt: Parameters<typeof handlePaystackEvent>[0];
  try {
    evt = JSON.parse(body.toString("utf8"));
  } catch {
    return res.sendStatus(400);
  }
  // The same Paystack account serves DakyXTech OS; only act on payments this product created.
  const meta = evt.data?.metadata;
  const ours = typeof meta === "object" && meta?.product === "whatsapp-crm";
  const reference = evt.data?.reference ?? "";
  if (evt.event === "charge.success" && !ours && !reference.startsWith("wcrm-") && !evt.data?.plan) return res.sendStatus(200);
  res.sendStatus(200);
  handlePaystackEvent(evt).catch((err) => console.error("[webhook:paystack]", err));
});
