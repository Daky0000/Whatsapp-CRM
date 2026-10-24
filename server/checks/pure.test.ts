import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

process.env.ENCRYPTION_KEY ??= "a".repeat(64);
process.env.SESSION_SECRET ??= "test-session-secret";

const { normalizePhone, waLink } = await import("../src/lib/phone.js");
const { parseChatExport } = await import("../src/lib/chatExport.js");
const { isActive, limitsFor, PLANS, priceFor } = await import("../src/lib/plans.js");
const { isOutsideHours, keywordMatches } = await import("../src/services/autoReply.js");
const { verifyMetaSignature } = await import("../src/lib/whatsapp.js");
const { encrypt, decrypt, hashPassword, verifyPassword } = await import("../src/lib/crypto.js");
const { parseCsv } = await import("../src/routes/contacts.js");
const { addMonths } = await import("../src/services/billing.js");
const { readSession } = await import("../src/lib/auth.js");
const { messageText } = await import("../src/services/inbound.js");

test("Ghana numbers normalise to one identity however they are written", () => {
  for (const v of ["024 123 4567", "0241234567", "+233 24 123 4567", "233241234567", "00233241234567", "241234567"]) {
    assert.equal(normalizePhone(v), "233241234567", v);
  }
  assert.equal(normalizePhone("+44 7700 900123"), "447700900123");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("+233 24 123 456"), null, "a Ghana number one digit short is refused, not guessed");
  assert.equal(waLink("233241234567", "Hi & bye"), "https://wa.me/233241234567?text=Hi%20%26%20bye");
});

test("Android export, day-first, multi-line and system lines", () => {
  const text = [
    "24/10/2026, 14:05 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
    "24/10/2026, 14:05 - Kofi Mensah: Is the red bag available?",
    "I want 2",
    "24/10/2026, 14:07 - Ama Shop: Yes dear, GHS 150 each",
    "25/10/2026, 09:00 - Kofi Mensah: <Media omitted>",
  ].join("\n");
  const parsed = parseChatExport(text);
  assert.deepEqual(parsed.participants, ["Kofi Mensah", "Ama Shop"]);
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.messages[0]!.body, "Is the red bag available?\nI want 2");
  assert.equal(parsed.messages[0]!.timestamp.toISOString(), "2026-10-24T14:05:00.000Z");
  assert.equal(parsed.messages[2]!.isMedia, true);
});

test("iOS export with seconds, 12-hour clock and month-first dates", () => {
  const text = ["[10/24/26, 2:05:33 PM] Kofi: hello", "[10/24/26, 12:10:00 AM] +233 24 123 4567: price?"].join("\n");
  const parsed = parseChatExport(text);
  assert.equal(parsed.messages[0]!.timestamp.toISOString(), "2026-10-24T14:05:33.000Z");
  assert.equal(parsed.messages[1]!.timestamp.toISOString(), "2026-10-24T00:10:00.000Z");
  assert.equal(parsed.messages[1]!.author, "+233 24 123 4567");
});

test("plans: trial gets Pro, lapsed workspaces stop, grace covers a late renewal", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const day = 86_400_000;
  assert.equal(isActive({ plan: "STARTER", status: "TRIALING", trialEndsAt: new Date(now.getTime() + day), currentPeriodEnd: null }, now), true);
  assert.equal(isActive({ plan: "STARTER", status: "TRIALING", trialEndsAt: new Date(now.getTime() - 1), currentPeriodEnd: null }, now), false);
  assert.equal(isActive({ plan: "PRO", status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() - 2 * day) }, now), true);
  assert.equal(isActive({ plan: "PRO", status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() - 4 * day) }, now), false);
  assert.equal(isActive({ plan: "PRO", status: "EXPIRED", trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() + day) }, now), false);
  assert.equal(limitsFor({ plan: "STARTER", status: "TRIALING", trialEndsAt: null, currentPeriodEnd: null }), PLANS.PRO);
  assert.equal(limitsFor({ plan: "STARTER", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null }), PLANS.STARTER);
  assert.equal(priceFor("STARTER", 1), 50);
  assert.equal(priceFor("PRO", 1), 150);
  assert.equal(priceFor("PRO", 12), 1500);
});

test("business hours, including overnight shops", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 24, h, 0));
  assert.equal(isOutsideHours("08:00", "20:00", at(9)), false);
  assert.equal(isOutsideHours("08:00", "20:00", at(21)), true);
  assert.equal(isOutsideHours("08:00", "20:00", at(7)), true);
  assert.equal(isOutsideHours("18:00", "02:00", at(23)), false);
  assert.equal(isOutsideHours("18:00", "02:00", at(10)), true);
});

test("keywords match whole words, any case, through punctuation", () => {
  const rule = { keywords: ["price", "how much"] };
  assert.equal(keywordMatches(rule, "PRICE?"), true);
  assert.equal(keywordMatches(rule, "pls how much is it"), true);
  assert.equal(keywordMatches(rule, "priceless"), false);
});

test("Meta webhook signature is checked over the exact bytes", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const good = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, good, "s3cret"), true);
  assert.equal(verifyMetaSignature(Buffer.from(body.toString() + " "), good, "s3cret"), false);
  assert.equal(verifyMetaSignature(body, undefined, "s3cret"), false);
  assert.equal(verifyMetaSignature(body, "sha256=abc", "s3cret"), false);
});

test("tokens encrypt and decrypt; tampering is detected", async () => {
  const sealed = encrypt("EAAG-token");
  assert.notEqual(sealed, encrypt("EAAG-token"), "fresh IV every time");
  assert.equal(decrypt(sealed), "EAAG-token");
  const [iv, tag, body] = sealed.split(".");
  assert.throws(() => decrypt([iv, tag, body!.slice(0, -2) + "AA"].join(".")));
  const hash = await hashPassword("correct horse");
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("session tokens reject tampering", () => {
  assert.equal(readSession("user1.9999999999999.deadbeef"), null);
  assert.equal(readSession(undefined), null);
});

test("CSV with quotes and commas", () => {
  assert.deepEqual(parseCsv('name,phone\n"Mensah, Kofi",024 123 4567\r\nAma,"0201112222"\n'), [
    ["name", "phone"],
    ["Mensah, Kofi", "024 123 4567"],
    ["Ama", "0201112222"],
  ]);
});

test("months add without overflowing short months", () => {
  assert.equal(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addMonths(new Date("2026-10-24T10:00:00Z"), 12).toISOString(), "2027-10-24T10:00:00.000Z");
});

test("webhook message bodies by type", () => {
  assert.deepEqual(messageText({ id: "1", timestamp: "0", type: "text", text: { body: "hi" } }), { body: "hi", mediaId: null });
  assert.deepEqual(messageText({ id: "1", timestamp: "0", type: "audio", audio: { id: "m1" } }), { body: null, mediaId: "m1" });
  assert.deepEqual(messageText({ id: "1", timestamp: "0", type: "interactive", interactive: { button_reply: { title: "Yes" } } }), {
    body: "Yes",
    mediaId: null,
  });
});
