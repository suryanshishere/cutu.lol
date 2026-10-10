import { test } from "node:test";
import assert from "node:assert/strict";
import { DOWNLOAD_EVENT_TTL_MS, createMemoryDownloadStore, handleDownloadEvent } from "../src/download-events.js";

const origin = "https://cutu.example";
function request(body, headers = {}) {
  return new Request(`${origin}/api/download-event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body)
  });
}

test("download validation rejects invalid requests before recording", async () => {
  const event = { format: "video", id: crypto.randomUUID() };
  const cases = [
    [new Request(`${origin}/api/download-event`), 405],
    [request(event, { Origin: "https://other.example" }), 403],
    [request(event, { Origin: "" }), 403],
    [request(event, { "Content-Type": "text/plain" }), 415],
    [request({ ...event, format: "other" }), 400],
    [request({ ...event, id: "invalid" }), 400],
    [request(null), 400]
  ];
  for (const [input, status] of cases) {
    const response = await handleDownloadEvent(input, () => assert.fail("Invalid event must not count"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  let recorded;
  const response = await handleDownloadEvent(request(event), (value) => { recorded = value; });
  assert.deepEqual(recorded, event);
  assert.deepEqual(await response.json(), { ok: true });
});

test("local counts deduplicate across formats and expire IDs after 24 hours", () => {
  const store = createMemoryDownloadStore();
  const id = crypto.randomUUID();
  store.recordEvent({ format: "gif", id }, 1000);
  store.recordEvent({ format: "video", id }, 1001);
  assert.deepEqual(store.readCounts(), { video: 0, gif: 1 });
  store.readCounts().gif = 99;
  assert.equal(store.readCounts().gif, 1);
  store.recordEvent({ format: "video", id }, 1000 + DOWNLOAD_EVENT_TTL_MS);
  assert.deepEqual(store.readCounts(), { video: 1, gif: 1 });
});
