import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";

/**
 * The message wallet pays Meta's per-message fees for broadcasts. Balances are
 * pesewas. A debit only happens when the balance covers it (conditional
 * update), so the balance can never go negative under concurrent broadcasts.
 */
export async function debitWallet(workspaceId: string, pesewas: number, description: string): Promise<void> {
  if (pesewas <= 0) return;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workspace.updateMany({
      where: { id: workspaceId, walletPesewas: { gte: pesewas } },
      data: { walletPesewas: { decrement: pesewas } },
    });
    if (updated.count !== 1) {
      throw new HttpError(402, `Your message wallet doesn't have enough for this (GHS ${(pesewas / 100).toFixed(2)} needed). Top up under Billing.`, "wallet");
    }
    await tx.walletTransaction.create({ data: { workspaceId, amountPesewas: -pesewas, description } });
  });
}

export async function creditWallet(workspaceId: string, pesewas: number, description: string, reference?: string): Promise<void> {
  if (pesewas <= 0) return;
  await prisma.$transaction([
    prisma.workspace.update({ where: { id: workspaceId }, data: { walletPesewas: { increment: pesewas } } }),
    prisma.walletTransaction.create({ data: { workspaceId, amountPesewas: pesewas, description, reference } }),
  ]);
}
