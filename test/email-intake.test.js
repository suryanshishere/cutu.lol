import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmailIntake, handleEmailIntake, normalizeEmail } from "../src/email-intake.js";
import { createLocalEmailStore } from "../src/local-email-store.js";

function request(payload, overrides = {}) {
  return new Request("https://cutu.example/api/email-intake", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), ...overrides
  });
}

test("email validation and normalization", () => {
  assert.equal(normalizeEmail("  Person+boo@Example.COM  "), "person+boo@example.com");
  for (const invalid of [null, 42, "", "boo", "a@@b.com", "a@b", "a b@b.com", "a@-b.com", "a@b..com", `${"a".repeat(65)}@b.com`, `${"a".repeat(64)}@${"b".repeat(190)}.com`]) {
    assert.equal(normalizeEmail(invalid), null);
  }
});

test("intake persists only valid input and returns no email data", async () => {
  let saved;
  const response = await handleEmailIntake(request({ email: " Boo@Example.com " }), async (email) => { saved = email; });
  assert.equal(saved, "boo@example.com");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("intake rejects invalid, malformed, cross-origin, wrong-method, and oversized requests without writing", async () => {
  let writes = 0;
  const save = async () => { writes += 1; };
  const cases = [
    [request({ email: "bad" }), 400],
    [request(null), 400],
    [request({ email: ["a@b.com"] }), 400],
    [request({}, { body: "{" }), 400],
    [request({}, { headers: { "Content-Type": "text/plain" } }), 415],
    [request({}, { headers: { "Content-Type": "application/json", Origin: "https://other.example" } }), 403],
    [new Request("https://cutu.example/api/email-intake"), 405],
    [request({ email: "a@b.com", padding: "x".repeat(1100) }), 413],
    [request({}, { headers: { "Content-Type": "application/json", "Content-Length": "2048" } }), 413]
  ];
  for (const [input, expected] of cases) assert.equal((await handleEmailIntake(input, save)).status, expected);
  assert.equal(writes, 0);
});

test("storage failure returns a retryable error without exposing details", async () => {
  const response = await handleEmailIntake(request({ email: "boo@example.com" }), async () => { throw new Error("private storage details"); });
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("private storage"), false);
});

test("Durable Object keeps one entry and its original creation timestamp", async () => {
  const entries = new Map();
  let writes = 0;
  const storage = {
    get: async (key) => entries.get(key),
    put: async (key, value) => { entries.set(key, value); writes += 1; },
    transaction: async (callback) => callback(storage)
  };
  const intake = new EmailIntake({ storage });
  assert.equal((await intake.fetch(request({ email: " Boo@Example.com " }))).status, 200);
  const original = entries.get("email:boo@example.com");
  assert.ok(Number.isFinite(Date.parse(original.createdAt)));
  assert.equal((await intake.fetch(request({ email: "boo@example.com" }))).status, 200);
  assert.equal(entries.size, 1);
  assert.equal(writes, 1);
  assert.deepEqual(entries.get("email:boo@example.com"), original);
  assert.equal((await intake.fetch(new Request("https://cutu.example/api/email-intake"))).status, 405);
});

test("local store persists concurrent submissions, deduplicates, and recovers after failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cutu-email-test-"));
  try {
    const path = join(directory, "emails.json");
    const save = createLocalEmailStore(path);
    await Promise.all([save("one@example.com"), save("two@example.com"), save("one@example.com")]);
    const entries = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(entries.map((entry) => entry.email), ["one@example.com", "two@example.com"]);
    await createLocalEmailStore(path)("one@example.com");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), entries);
    await writeFile(path, "corrupt");
    await assert.rejects(save("three@example.com"));
    await writeFile(path, JSON.stringify(entries));
    await save("three@example.com");
    assert.equal(JSON.parse(await readFile(path, "utf8")).length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
