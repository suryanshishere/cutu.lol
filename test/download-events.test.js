import { test } from "node:test";
import assert from "node:assert/strict";
import { DOWNLOAD_EVENT_TTL_MS, createMemoryDownloadStore, handleDownloadEvent, templateDownloadRows } from "../src/download-events.js";

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
    ...["missing-template", "__proto__", "constructor", null, {}, 123].map((template) => [request({ ...event, template }), 400]),
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
  for (const template of ["baby-boo", "speed"]) {
    const attributed = { ...event, template };
    assert.equal((await handleDownloadEvent(request(attributed), (value) => { recorded = value; })).status, 200);
    assert.deepEqual(recorded, attributed);
  }
});

test("template counts follow the first event and survive request ID cleanup", () => {
  const store = createMemoryDownloadStore();
  const id = crypto.randomUUID();
  store.recordEvent({ format: "gif", template: "speed", id }, 1000);
  store.recordEvent({ format: "video", template: "baby-boo", id }, 1001);
  store.recordEvent({ format: "video", id: crypto.randomUUID() }, 1002);
  assert.deepEqual(store.readTemplates(), { speed: { video: 0, gif: 1 } });
  store.readTemplates().speed.gif = 99;
  assert.equal(store.readTemplates().speed.gif, 1);
  store.recordEvent({ format: "video", template: "baby-boo", id }, 1000 + DOWNLOAD_EVENT_TTL_MS);
  assert.deepEqual(templateDownloadRows(store.readCounts(), store.readTemplates()), [
    { id: "baby-boo", name: "Baby Boo", video: 1, gif: 0, total: 1 },
    { id: "speed", name: "Speed", video: 0, gif: 1, total: 1 },
    { id: "unknown", name: "Template not recorded", video: 1, gif: 0, total: 1 }
  ]);
});

test("template breakdown preserves historical totals and shows unused templates", () => {
  assert.deepEqual(templateDownloadRows({ video: 0, gif: 0 }), [
    { id: "baby-boo", name: "Baby Boo", video: 0, gif: 0, total: 0 },
    { id: "speed", name: "Speed", video: 0, gif: 0, total: 0 }
  ]);
  const rows = templateDownloadRows({ video: 20, gif: 12 }, { speed: { video: 3, gif: 2 } });
  assert.deepEqual(rows.map(({ id, total }) => ({ id, total })), [
    { id: "unknown", total: 27 }, { id: "speed", total: 5 }, { id: "baby-boo", total: 0 }
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.video, 0), 20);
  assert.equal(rows.reduce((sum, row) => sum + row.gif, 0), 12);
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
