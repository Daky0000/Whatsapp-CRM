import { prisma } from "../db.js";
import type { BusinessContext } from "../lib/ai.js";

export async function businessContext(workspaceId: string): Promise<BusinessContext> {
  const w = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      products: { orderBy: { name: "asc" }, take: 200 },
      knowledge: { orderBy: { createdAt: "asc" }, take: 100 },
    },
  });
  return {
    name: w.name,
    description: w.businessDescription,
    brandVoice: w.brandVoice,
    replyLanguage: w.replyLanguage,
    products: w.products.map((p) => ({ name: p.name, priceGhs: p.priceGhs.toFixed(2), description: p.description, inStock: p.inStock })),
    knowledge: w.knowledge.map((k) => ({ question: k.question, answer: k.answer })),
  };
}
