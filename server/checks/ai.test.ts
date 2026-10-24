import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

/**
 * Runs analyzeConversation against a local stand-in for the Anthropic API, so
 * the request shape and the parsing of the structured reply are checked
 * without a key or a network.
 */
test("analyzeConversation sends a structured-output request and parses the result", async () => {
  let seen: { headers: Record<string, unknown>; body: Record<string, any> } | null = null;
  const analysis = {
    category: "ORDER",
    isBusiness: true,
    summary: "Yaw wants 2 red bags delivered to Kumasi.",
    urgency: 9,
    needsReply: true,
    stage: "ORDERED",
    order: { items: [{ name: "Red leather bag", quantity: 2, variant: null, unitPriceGhs: 150 }], deliveryLocation: "Kumasi", totalGhs: 340 },
    customerName: "Yaw",
    reply: "Thank you Yaw! 2 red bags is GHS 300 plus GHS 40 delivery to Kumasi. Shall I send the MoMo number?",
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen = { headers: req.headers, body: JSON.parse(raw) };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: seen.body.model,
          content: [{ type: "text", text: JSON.stringify(analysis) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_AUTH_TOKEN = "";

  try {
    const { analyzeConversation } = await import("../src/lib/ai.js");
    const result = await analyzeConversation({
      business: { name: "Ama Bags", description: null, brandVoice: "friendly", replyLanguage: "English", products: [], knowledge: [] },
      lines: [{ from: "customer", at: new Date("2026-10-24T10:00:00Z"), text: "send me 2 red bags to Kumasi" }],
      wantDraft: true,
      model: "claude-opus-5-5",
    });
    assert.equal(result.category, "ORDER");
    assert.equal(result.urgency, 5, "urgency is clamped to 1–5");
    assert.equal(result.order?.items[0]?.quantity, 2);
    assert.match(result.reply ?? "", /Kumasi/);

    assert.ok(seen);
    assert.equal(seen!.body.model, "claude-opus-5-5");
    assert.equal(seen!.body.output_config.format.type, "json_schema");
    assert.equal(seen!.body.fallbacks, "default");
    assert.match(String(seen!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.match(seen!.body.messages[0].content, /CUSTOMER: send me 2 red bags/);
  } finally {
    server.close();
  }
});
