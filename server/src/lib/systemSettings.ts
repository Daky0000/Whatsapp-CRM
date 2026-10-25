import { prisma } from "../db.js";
import { config } from "../config.js";
import { decrypt, encrypt } from "./crypto.js";

/**
 * Platform-wide dynamic settings stored in prisma.appSetting.
 * Sensitive keys are stored encrypted at rest with AES-256-GCM.
 * Values are cached in memory for high throughput and invalidated on write.
 */

const ENCRYPTED_KEYS = new Set([
  "META_APP_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_TEST_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "VYNFY_API_KEY",
]);

let memoryCache: Map<string, string | null> | null = null;
let lastCacheFetch = 0;
const CACHE_TTL_MS = 60_000;

async function loadCache(): Promise<Map<string, string | null>> {
  if (memoryCache && Date.now() - lastCacheFetch < CACHE_TTL_MS) {
    return memoryCache;
  }
  const settings = await prisma.appSetting.findMany();
  const map = new Map<string, string | null>();
  for (const s of settings) {
    if (ENCRYPTED_KEYS.has(s.key) && s.value) {
      try {
        map.set(s.key, decrypt(s.value));
      } catch {
        map.set(s.key, s.value); // fallback if stored unencrypted
      }
    } else {
      map.set(s.key, s.value);
    }
  }
  memoryCache = map;
  lastCacheFetch = Date.now();
  return map;
}

export function invalidateSettingsCache() {
  memoryCache = null;
  lastCacheFetch = 0;
}

/**
 * Synchronous read from in-memory cache with fallback to process.env.
 */
export function getSettingSync(key: string, fallback = ""): string {
  if (memoryCache) {
    const cached = memoryCache.get(key);
    if (cached !== undefined && cached !== null && cached.trim() !== "") {
      return cached.trim();
    }
  }
  const envVal = process.env[key];
  if (envVal !== undefined && envVal.trim() !== "") {
    return envVal.trim();
  }
  return fallback;
}

/**
 * Gets a platform setting by key.
 * Precedence: DB AppSetting > Environment variable > fallback default.
 */
export async function getSetting(key: string, fallback = ""): Promise<string> {
  try {
    const cache = await loadCache();
    const dbVal = cache.get(key);
    if (dbVal !== undefined && dbVal !== null && dbVal.trim() !== "") {
      return dbVal.trim();
    }
  } catch (err) {
    console.warn(`[settings] could not read setting ${key} from DB:`, (err as Error).message);
  }
  const envVal = process.env[key];
  if (envVal !== undefined && envVal.trim() !== "") {
    return envVal.trim();
  }
  return fallback;
}

/**
 * Updates a platform setting. Encrypts automatically if in ENCRYPTED_KEYS.
 */
export async function setSetting(key: string, value: string | null): Promise<void> {
  invalidateSettingsCache();
  if (value === null || value.trim() === "") {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  const cleanVal = value.trim();
  const storedVal = ENCRYPTED_KEYS.has(key) ? encrypt(cleanVal) : cleanVal;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: storedVal },
    update: { value: storedVal },
  });
}

/**
 * Mask secret strings (show first 3 and last 4 chars, stars in between).
 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret || secret.length < 8) return secret ? "••••••••" : "";
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

export interface PlatformConfigResponse {
  whatsapp: {
    appId: string;
    hasAppSecret: boolean;
    appSecretMasked: string;
    configId: string;
    verifyToken: string;
    graphVersion: string;
    hasAccessToken: boolean;
    accessTokenMasked: string;
    phoneNumberId: string;
    wabaId: string;
    webhookUrl: string;
    coexistence: boolean;
    embeddedSignupReady: boolean;
  };
  paystack: {
    mode: "live" | "test";
    hasLiveSecret: boolean;
    liveSecretMasked: string;
    livePublicKey: string;
    hasTestSecret: boolean;
    testSecretMasked: string;
    testPublicKey: string;
    webhookUrl: string;
    starterPriceGhs: number;
    proPriceGhs: number;
  };
  ai: {
    hasApiKey: boolean;
    apiKeyMasked: string;
    triageModel: string;
    draftModel: string;
    marginMultiplier: number;
  };
  vynfy: {
    hasApiKey: boolean;
    apiKeyMasked: string;
    senderId: string;
  };
  email: {
    fromAddress: string;
    senderName: string;
  };
}

export async function getPlatformConfigSummary(): Promise<PlatformConfigResponse> {
  const [
    metaAppId,
    metaAppSecret,
    metaConfigId,
    verifyToken,
    graphVersion,
    accessToken,
    phoneNumberId,
    wabaId,
    paystackMode,
    paystackLiveSecret,
    paystackLivePublic,
    paystackTestSecret,
    paystackTestPublic,
    starterPrice,
    proPrice,
    anthropicKey,
    triageModel,
    draftModel,
    vynfyKey,
    vynfySender,
    fromAddress,
    senderName,
  ] = await Promise.all([
    getSetting("META_APP_ID", config.meta.appId),
    getSetting("META_APP_SECRET", config.meta.appSecret),
    getSetting("META_CONFIG_ID", config.meta.configId),
    getSetting("WHATSAPP_VERIFY_TOKEN", config.meta.verifyToken),
    getSetting("WHATSAPP_GRAPH_VERSION", config.meta.graphVersion),
    getSetting("WHATSAPP_ACCESS_TOKEN", ""),
    getSetting("WHATSAPP_PHONE_NUMBER_ID", ""),
    getSetting("WHATSAPP_WABA_ID", ""),
    getSetting("PAYSTACK_MODE", process.env.PAYSTACK_MODE || "live"),
    getSetting("PAYSTACK_SECRET_KEY", process.env.PAYSTACK_SECRET_KEY || ""),
    getSetting("PAYSTACK_PUBLIC_KEY", process.env.PAYSTACK_PUBLIC_KEY || ""),
    getSetting("PAYSTACK_TEST_SECRET_KEY", process.env.PAYSTACK_TEST_SECRET_KEY || ""),
    getSetting("PAYSTACK_TEST_PUBLIC_KEY", process.env.PAYSTACK_TEST_PUBLIC_KEY || ""),
    getSetting("STARTER_PRICE_GHS", "50"),
    getSetting("PRO_PRICE_GHS", "150"),
    getSetting("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY || ""),
    getSetting("AI_TRIAGE_MODEL", config.ai.triageModel),
    getSetting("AI_DRAFT_MODEL", config.ai.draftModel),
    getSetting("VYNFY_API_KEY", process.env.VYNFY_API_KEY || ""),
    getSetting("VYNFY_SENDER_ID", process.env.VYNFY_SENDER_ID || "DakyXTech"),
    getSetting("MAIL_FROM_ADDRESS", process.env.MAIL_FROM_ADDRESS || "noreply@dakyx.com"),
    getSetting("MAIL_SENDER_NAME", process.env.MAIL_SENDER_NAME || "DakyX WhatsApp CRM"),
  ]);

  return {
    whatsapp: {
      appId: metaAppId,
      hasAppSecret: Boolean(metaAppSecret),
      appSecretMasked: maskSecret(metaAppSecret),
      configId: metaConfigId,
      verifyToken,
      graphVersion,
      hasAccessToken: Boolean(accessToken),
      accessTokenMasked: maskSecret(accessToken),
      phoneNumberId,
      wabaId,
      webhookUrl: `${config.publicUrl}/webhooks/whatsapp`,
      coexistence: true,
      embeddedSignupReady: Boolean(metaAppId && metaConfigId && metaAppSecret),
    },
    paystack: {
      mode: paystackMode === "test" ? "test" : "live",
      hasLiveSecret: Boolean(paystackLiveSecret),
      liveSecretMasked: maskSecret(paystackLiveSecret),
      livePublicKey: paystackLivePublic,
      hasTestSecret: Boolean(paystackTestSecret),
      testSecretMasked: maskSecret(paystackTestSecret),
      testPublicKey: paystackTestPublic,
      webhookUrl: `${config.publicUrl}/webhooks/paystack`,
      starterPriceGhs: Number(starterPrice) || 50,
      proPriceGhs: Number(proPrice) || 150,
    },
    ai: {
      hasApiKey: Boolean(anthropicKey),
      apiKeyMasked: maskSecret(anthropicKey),
      triageModel,
      draftModel,
      marginMultiplier: 1.5,
    },
    vynfy: {
      hasApiKey: Boolean(vynfyKey),
      apiKeyMasked: maskSecret(vynfyKey),
      senderId: vynfySender,
    },
    email: {
      fromAddress,
      senderName,
    },
  };
}
