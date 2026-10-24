import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See server/.env.example.`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:8080").replace(/\/$/, ""),
  production: process.env.NODE_ENV === "production",
  sessionSecret: () => required("SESSION_SECRET"),
  encryptionKey: () => required("ENCRYPTION_KEY"),
  meta: {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    configId: process.env.META_CONFIG_ID ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0",
    marketingPesewas: Number(process.env.WA_MARKETING_PESEWAS ?? 40),
  },
  ai: {
    triageModel: process.env.AI_TRIAGE_MODEL ?? "claude-opus-5-5",
    draftModel: process.env.AI_DRAFT_MODEL ?? "claude-opus-5-5",
    enabled: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
};
