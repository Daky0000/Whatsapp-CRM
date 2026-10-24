import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "test-session-secret";
process.env.ENCRYPTION_KEY ??= "a".repeat(64);

type Handler = (path: string, body: any, req: IncomingMessage) => { status: number; body: unknown; raw?: string };

async function standIn(handler: Handler) {
  const seen: Array<{ path: string; body: any; headers: IncomingMessage["headers"] }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ path: req.url ?? "", body, headers: req.headers });
      const out = handler(req.url ?? "", body, req);
      res.statusCode = out.status;
      res.setHeader("content-type", out.raw ? "text/html" : "application/json");
      res.end(out.raw ?? JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => server.close() };
}

test("Vynfy: sends, treats a pending code as sent, verifies, and names its failures", async () => {
  let generateCalls = 0;
  const s = await standIn((path, body) => {
    if (path === "/otp/generate") {
      generateCalls++;
      if (body.number === "233200000001") return { status: 429, body: { success: false, error_code: "OTP_PENDING" } };
      if (body.number === "233200000002") return { status: 400, body: { success: false, error_code: "INVALID_PHONE" } };
      if (body.number === "233200000003") return { status: 503, body: {}, raw: "<html>Cloudflare challenge</html>" };
      return { status: 200, body: { success: true, otp_id: 1, ussd_code: "*928*01#" } };
    }
    if (path === "/otp/verify") {
      return body.code === "123456"
        ? { status: 200, body: { success: true } }
        : { status: 400, body: { success: false, error_code: "INVALID_OTP", attempts_remaining: 2 } };
    }
    return { status: 404, body: {} };
  });
  process.env.VYNFY_BASE_URL = s.url;
  process.env.VYNFY_API_KEY = "vk-test";
  process.env.VYNFY_SENDER_ID = "DakyX";
  const { vynfySendOtp, vynfyVerifyOtp } = await import("../src/lib/vynfy.js");
  try {
    assert.deepEqual(await vynfySendOtp("024 123 4567", "sms"), { ok: true, ussdCode: "*928*01#" });
    const sent = s.seen[0]!;
    assert.equal(sent.headers["x-api-key"], "vk-test");
    assert.equal(sent.body.number, "233241234567", "Ghana numbers go out in the bare 233 form");
    assert.equal(sent.body.sender_id, "DakyX");
    assert.equal(sent.body.medium, "sms");
    assert.match(sent.body.message, /%otp_code%/);
    assert.ok(sent.body.message.length <= 160);

    assert.equal((await vynfySendOtp("0241234567", "voice")).ok, true);
    assert.equal(s.seen[1]!.body.medium, "voice");

    assert.deepEqual(await vynfySendOtp("0200000001", "sms"), { ok: true, pending: true, ussdCode: "*928*01#" });

    generateCalls = 0;
    const invalid = await vynfySendOtp("0200000002", "sms");
    assert.equal(invalid.ok, false);
    assert.equal(generateCalls, 1, "a fatal refusal is not retried");
    assert.equal(!invalid.ok && invalid.fatal, true);

    generateCalls = 0;
    const challenged = await vynfySendOtp("0200000003", "sms");
    assert.equal(generateCalls, 3, "an unknown failure (HTML challenge page) is retried");
    assert.equal(!challenged.ok && challenged.fatal, false, "and is not called fatal: the code may still have gone out");

    assert.deepEqual(await vynfyVerifyOtp("0241234567", "123456"), { ok: true });
    const wrong = await vynfyVerifyOtp("0241234567", "000000");
    assert.equal(!wrong.ok && wrong.message, "That code isn't right. 2 attempts left before you need a new one.");
  } finally {
    s.close();
  }
});

test("mail: OS variable names choose the transport; Hostinger sends through its Mail API", async () => {
  const keys = ["MAIL_TRANSPORT", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM_EMAIL", "HOSTINGER_MAIL_TOKEN", "HOSTINGER_MAILBOX_ID", "HOSTINGER_MAILBOX_ADDRESS", "MAIL_FROM_NAME"];
  for (const k of keys) delete process.env[k];
  const { activeTransport, sendMail } = await import("../src/lib/mail.js");
  assert.equal(activeTransport(), null);
  assert.equal(await sendMail({ to: "a@b.c", subject: "s", text: "t", html: "h" }), false, "unconfigured mail is skipped, not an error");

  Object.assign(process.env, { HOSTINGER_MAIL_TOKEN: "hm-token", HOSTINGER_MAILBOX_ID: "AC123", HOSTINGER_MAILBOX_ADDRESS: "hello@dakyx.com", MAIL_FROM_NAME: "DakyX" });
  assert.equal(activeTransport(), "HOSTINGER");
  Object.assign(process.env, { SMTP_HOST: "smtp.hostinger.com", SMTP_USER: "u", SMTP_PASSWORD: "p", MAIL_FROM_EMAIL: "hello@dakyx.com" });
  assert.equal(activeTransport(), "SMTP", "with both configured and no choice stored, SMTP first, as in the OS");
  process.env.MAIL_TRANSPORT = "HOSTINGER";
  assert.equal(activeTransport(), "HOSTINGER", "the stored choice wins");

  const s = await standIn(() => ({ status: 202, body: {} }));
  process.env.HOSTINGER_MAIL_API = s.url;
  try {
    assert.equal(await sendMail({ to: "seller@example.com", subject: "Reset", text: "t", html: "<p>h</p>" }), true);
    assert.equal(s.seen[0]!.path, "/api/v1/mailboxes/AC123/send");
    assert.equal(s.seen[0]!.headers.authorization, "Bearer hm-token");
    assert.deepEqual(s.seen[0]!.body, { to: ["seller@example.com"], subject: "Reset", text: "t", html: "<p>h</p>", displayName: "DakyX" });
  } finally {
    s.close();
    for (const k of [...keys, "HOSTINGER_MAIL_API"]) delete process.env[k];
  }
});

test("rate limits refuse past the limit within the window", async () => {
  const { hit } = await import("../src/lib/rateLimit.js");
  const key = `t:${Math.random()}`;
  hit(key, 2, 60_000);
  hit(key, 2, 60_000);
  assert.throws(() => hit(key, 2, 60_000), /Too many/);
});

test("sessions carry when they were issued, so a password reset can end older ones", async () => {
  const { issueSession, readSession, SESSION_COOKIE } = await import("../src/lib/auth.js");
  let cookie = "";
  issueSession({ cookie: (name: string, value: string) => name === SESSION_COOKIE && (cookie = value) } as never, "user-1");
  const before = Date.now();
  const session = readSession(cookie);
  assert.equal(session?.userId, "user-1");
  assert.ok(Math.abs(session!.issuedAt - before) < 5_000);
});
