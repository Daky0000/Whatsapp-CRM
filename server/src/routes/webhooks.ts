import express, { Router } from "express";
import { config } from "../config.js";
import { verifyPaystackSignature } from "../lib/paystack.js";
import { verifyMetaSignature } from "../lib/whatsapp.js";
import { prisma } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { checkOrderPayment } from "../services/payLinks.js";
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

/**
 * A seller's own Paystack account, for payment links to their customers. Each
 * seller pastes their URL into their Paystack dashboard; the signature is
 * checked with that seller's key, so one seller can't forge another's payment.
 */
webhooksRouter.post("/paystack-merchant/:workspaceId", raw, async (req, res) => {
  const body = req.body as Buffer;
  const workspace = await prisma.workspace
    .findUnique({ where: { id: String(req.params.workspaceId) }, select: { id: true, merchantPaystackKeyEnc: true } })
    .catch(() => null);
  const key = workspace?.merchantPaystackKeyEnc ? decrypt(workspace.merchantPaystackKeyEnc) : null;
  if (!workspace || !key || !Buffer.isBuffer(body) || !verifyPaystackSignature(body, req.header("x-paystack-signature"), key)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const evt = JSON.parse(body.toString("utf8")) as { event?: string; data?: { reference?: string } };
    if (evt.event !== "charge.success" || !evt.data?.reference?.startsWith("wpay-")) return;
    const order = await prisma.order.findFirst({ where: { workspaceId: workspace.id, paymentReference: evt.data.reference }, select: { id: true } });
    // Re-verified with Paystack inside checkOrderPayment; the webhook only says "look now".
    if (order) await checkOrderPayment(workspace.id, order.id);
  } catch (err) {
    console.error("[webhook:paystack-merchant]", err);
  }
});
