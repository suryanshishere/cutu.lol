import { test } from "node:test";
import assert from "node:assert/strict";
import { readAdminBody } from "../src/admin.js";
import { handleEmailIntake } from "../src/email-intake.js";

function streamedRequest(chunks, headers = {}) {
  return new Request("https://cutu.example/api/email-intake", {
    method: "POST", duplex: "half",
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    })
  });
}

test("JSON parsing preserves UTF-8 split across streamed chunks", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ message: "Hello 🎉" }));
  const split = bytes.indexOf(0xf0) + 1;
  const result = await readAdminBody(streamedRequest([bytes.slice(0, split), bytes.slice(split)]));
  assert.deepEqual(result.value, { message: "Hello 🎉" });
});

test("intake and admin enforce their own byte limits on streamed bodies", async () => {
  for (const headers of [{}, { "Content-Length": "1" }]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ email: "a@b.com", padding: "x".repeat(1200) }));
    const chunks = [bytes.slice(0, 600), bytes.slice(600)];
    const intake = await handleEmailIntake(streamedRequest(chunks, headers), () => assert.fail("Oversized intake must not persist"));
    assert.equal(intake.status, 413);
    assert.ok((await readAdminBody(streamedRequest(chunks, headers))).value);
    const oversized = await readAdminBody(streamedRequest([new Uint8Array(2100)], headers));
    assert.equal(oversized.error.status, 413);
  }
});

test("malformed UTF-8 and non-object JSON never reach persistence", async () => {
  const invalidBodies = [new Uint8Array([0xff]), ...["null", "[]", "42", "{"].map((text) => new TextEncoder().encode(text))];
  for (const bytes of invalidBodies) {
    const intake = await handleEmailIntake(streamedRequest([bytes]), () => assert.fail("Invalid intake must not persist"));
    assert.equal(intake.status, 400);
    const admin = await readAdminBody(streamedRequest([bytes]));
    assert.equal(admin.error.status, 400);
  }
});
