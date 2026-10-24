import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

/** Both speech-to-text providers against a local stand-in: request shape in, transcript and length out. */
test("Deepgram and Whisper requests and responses", async () => {
  const seen: Array<{ url: string; auth: string; type: string; body: string }> = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: String(req.headers.authorization), type: String(req.headers["content-type"]), body: Buffer.concat(chunks).toString("latin1") });
      res.setHeader("content-type", "application/json");
      res.end(
        req.url?.startsWith("/v1/listen")
          ? JSON.stringify({ metadata: { duration: 7.2 }, results: { channels: [{ alternatives: [{ transcript: " Please is the red bag still available? " }] }] } })
          : JSON.stringify({ text: "Charley, how much be the shoe?", duration: 3.1 }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.TRANSCRIBE_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.TRANSCRIBE_API_KEY = "k-test";
  const { transcribe } = await import("../src/lib/transcribe.js");
  const audio = new TextEncoder().encode("OggS-fake-audio").buffer as ArrayBuffer;
  try {
    process.env.TRANSCRIBE_PROVIDER = "deepgram";
    assert.deepEqual(await transcribe(audio, "audio/ogg; codecs=opus"), { text: "Please is the red bag still available?", seconds: 8 });
    assert.match(seen[0]!.url, /model=nova-3/);
    assert.equal(seen[0]!.auth, "Token k-test");
    assert.equal(seen[0]!.type, "audio/ogg", "codec parameter stripped");
    assert.equal(seen[0]!.body, "OggS-fake-audio");

    process.env.TRANSCRIBE_PROVIDER = "openai";
    assert.deepEqual(await transcribe(audio, "audio/ogg"), { text: "Charley, how much be the shoe?", seconds: 4 });
    assert.equal(seen[1]!.url, "/v1/audio/transcriptions");
    assert.equal(seen[1]!.auth, "Bearer k-test");
    assert.match(seen[1]!.type, /^multipart\/form-data/);
    assert.match(seen[1]!.body, /filename="voice\.ogg"/);
    assert.match(seen[1]!.body, /whisper-1/);
  } finally {
    server.close();
  }
});
