import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { initializeTransaction, toPesewas, verifyTransaction } from "../lib/paystack.js";

/**
 * Payment links for a seller's customers, from the SELLER's own Paystack
 * account: the money settles to them, never through DakyXTech. A link is
 * only prepared here; the seller sends it in the chat like any other reply.
 */
export async function merchantKey(workspaceId: string): Promise<string> {
  const w = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { merchantPaystackKeyEnc: true } });
  if (!w.merchantPaystackKeyEnc) throw new HttpError(409, "Connect your own Paystack account in Settings → Payments first.", "no_merchant_key");
  return decrypt(w.merchantPaystackKeyEnc);
}

export async function createOrderPaymentLink(workspaceId: string, orderId: string, amountGhs?: number) {
  const order = await prisma.order.findFirst({ where: { id: orderId, workspaceId }, include: { contact: true, workspace: { select: { name: true } } } });
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.paidAt) throw new HttpError(409, "This order is already paid.");
  const amount = amountGhs ?? (order.totalGhs ? Number(order.totalGhs) : NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter the amount to charge. The order has no total yet.");
  const key = await merchantKey(workspaceId);

  // Paystack requires an email, and a WhatsApp customer usually hasn't given one.
  // The address is ours and receives nothing; the checkout still takes MoMo and card.
  const email = `c${order.contact.phone}@customers.dakyx.com`;
  const reference = `wpay-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
  const link = await initializeTransaction({
    key,
    email,
    amountPesewas: toPesewas(amount),
    reference,
    callbackUrl: `${config.publicUrl}/paid`,
    metadata: { product: "whatsapp-crm-order", workspaceId, orderId: order.id, custom_fields: [{ display_name: "Seller", variable_name: "seller", value: order.workspace.name }] },
  });
  await prisma.order.update({ where: { id: order.id }, data: { paymentReference: reference, paymentUrl: link.url, paymentPesewas: toPesewas(amount) } });

  const message = `Here is your secure payment link for ${amount.toFixed(2)} GHS. You can pay with Mobile Money or card: ${link.url}`;
  return { url: link.url, reference, message };
}

/** Checks an order's link with Paystack and marks it paid. Safe to call any number of times. */
export async function checkOrderPayment(workspaceId: string, orderId: string): Promise<"paid" | "unpaid" | "no_link"> {
  const order = await prisma.order.findFirst({ where: { id: orderId, workspaceId } });
  if (!order?.paymentReference) return "no_link";
  if (order.paidAt) return "paid";
  const tx = await verifyTransaction(order.paymentReference, await merchantKey(workspaceId));
  if (!tx.paid) return "unpaid";
  if (tx.currency !== "GHS" || tx.amountPesewas !== order.paymentPesewas) {
    console.error(`[pay-link] ${order.paymentReference}: paid ${tx.amountPesewas} ${tx.currency}, expected ${order.paymentPesewas}`);
    return "unpaid";
  }
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, paidAt: null },
    data: { paidAt: tx.paidAt ?? new Date(), paymentChannel: tx.channel, stage: "PAID" },
  });
  if (claimed.count) {
    // Never pull a delivered deal back to "paid".
    await prisma.conversation.updateMany({ where: { id: order.conversationId, stage: { in: ["NEW", "NEGOTIATING", "ORDERED"] } }, data: { stage: "PAID" } });
  }
  return "paid";
}

/** Customers often close the tab before Paystack's redirect; re-check open links from the last week. */
export async function reconcileOrderPayments() {
  const open = await prisma.order.findMany({
    where: { paymentReference: { not: null }, paidAt: null, updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    select: { id: true, workspaceId: true },
    take: 100,
  });
  for (const o of open) {
    await checkOrderPayment(o.workspaceId, o.id).catch((err) => console.warn(`[pay-link] ${o.id}: ${(err as Error).message}`));
  }
}
