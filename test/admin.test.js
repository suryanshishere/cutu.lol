import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryAdminStore, dashboardPage, handleAdminRequest, hashAdminPassword, verifyAdminPassword } from "../src/admin.js";
import { EmailIntake } from "../src/email-intake.js";

const password = "A-test-password-123!";
const env = { ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD_HASH: await hashAdminPassword(password) };
const origin = "https://cutu.example";
function request(path, body, cookie, headers = {}) {
  return new Request(`${origin}/api/admin/${path}`, {
    ...(body !== undefined ? { method: "POST", body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }
  });
}
const dashboard = async () => ({ emails: [{ email: "private@example.com", createdAt: "2026-10-10T00:00:00Z" }] });

test("salted password verification rejects wrong, missing, oversized, and malformed credentials", async () => {
  assert.equal(await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH), true);
  assert.equal(await verifyAdminPassword("wrong", env.ADMIN_PASSWORD_HASH), false);
  assert.equal(await verifyAdminPassword(null, env.ADMIN_PASSWORD_HASH), false);
  assert.equal(await verifyAdminPassword("x".repeat(300), env.ADMIN_PASSWORD_HASH), false);
  assert.equal(await verifyAdminPassword(password, "not-a-hash"), false);
  assert.notEqual(await hashAdminPassword(password), env.ADMIN_PASSWORD_HASH);
});

test("login protects data, issues a secure session, and logout revokes it", async () => {
  const store = createMemoryAdminStore();
  assert.equal((await handleAdminRequest(request("dashboard"), env, store, dashboard)).status, 401);
  const denied = await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password: "wrong" }), env, store, dashboard);
  assert.equal(denied.status, 401);
  const signedIn = await handleAdminRequest(request("login", { email: " ADMIN@EXAMPLE.COM ", password }), env, store, dashboard);
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("Set-Cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=28800"]) assert.ok(cookie.includes(flag));
  assert.equal((await signedIn.text()).includes(password), false);
  const auth = cookie.split(";")[0];
  assert.equal((await handleAdminRequest(request("session", undefined, auth), env, store, dashboard)).status, 200);
  const data = await handleAdminRequest(request("dashboard", undefined, auth), env, store, dashboard);
  assert.equal(data.status, 200);
  assert.equal(data.headers.get("Cache-Control"), "no-store");
  assert.equal((await data.json()).emails[0].email, "private@example.com");
  assert.equal((await handleAdminRequest(request("logout", {}, auth), env, store, dashboard)).status, 200);
  assert.equal((await handleAdminRequest(request("dashboard", undefined, auth), env, store, dashboard)).status, 401);
});

test("sessions expire and credential changes invalidate existing sessions", async () => {
  const store = createMemoryAdminStore();
  const response = await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }), env, store, dashboard, 100000);
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await handleAdminRequest(request("session", undefined, cookie), { ...env, ADMIN_EMAIL: "other@example.com" }, store, dashboard, 100001)).status, 401);
  const again = await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }), env, store, dashboard, 100000);
  const fresh = again.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await handleAdminRequest(request("session", undefined, fresh), env, store, dashboard, 100000 + 28800001)).status, 401);
});

test("invalid origins, methods, payloads, and missing secrets fail closed", async () => {
  const store = createMemoryAdminStore();
  assert.equal((await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }, undefined, { Origin: "https://evil.example" }), env, store, dashboard)).status, 403);
  assert.equal((await handleAdminRequest(request("login"), env, store, dashboard)).status, 405);
  assert.equal((await handleAdminRequest(request("unknown"), env, store, dashboard)).status, 404);
  assert.equal((await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }), {}, store, dashboard)).status, 503);
  const malformed = request("login", {});
  const broken = new Request(malformed, { body: "{" });
  assert.equal((await handleAdminRequest(broken, env, store, dashboard)).status, 400);
  const huge = request("login", { password: "x".repeat(3000) });
  assert.equal((await handleAdminRequest(huge, env, store, dashboard)).status, 413);
});

test("login attempts are throttled and recover after the window", async () => {
  const store = createMemoryAdminStore();
  for (let index = 0; index < 8; index++) assert.equal((await handleAdminRequest(request("login", { email: "wrong", password: null }), env, store, dashboard, 1000)).status, 401);
  const limited = await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }), env, store, dashboard, 1000);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  assert.equal((await handleAdminRequest(request("login", { email: env.ADMIN_EMAIL, password }), env, store, dashboard, 1000 + 900001)).status, 200);
});

test("dashboard pagination retains legacy collection dates and sorts newest first", () => {
  const emails = Array.from({ length: 205 }, (_, index) => ({ email: `person${index}@example.com`, createdAt: new Date(1700000000000 + index * 1000).toISOString() }));
  const first = dashboardPage(emails, { today: 3, total: 12 });
  assert.equal(first.totalEmails, 205);
  assert.equal(first.emails.length, 100);
  assert.equal(first.emails[0].email, "person204@example.com");
  assert.equal(first.nextOffset, 100);
  const last = dashboardPage(emails, {}, 200);
  assert.equal(last.emails.length, 5);
  assert.equal(last.nextOffset, null);
});

test("download counts deduplicate requests and reject invalid events", async () => {
  const entries = new Map();
  const storage = {
    get: async (key) => entries.get(key),
    put: async (key, value) => { if (typeof key === "object") for (const [name, item] of Object.entries(key)) entries.set(name, item); else entries.set(key, value); },
    transaction: async (fn) => fn(storage),
    getAlarm: async () => 123, setAlarm: async () => {}
  };
  const intake = new EmailIntake({ storage });
  const event = (body) => new Request(`${origin}/api/download-event`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  const id = crypto.randomUUID();
  assert.equal((await intake.fetch(event({ format: "gif", id }))).status, 200);
  assert.equal((await intake.fetch(event({ format: "gif", id }))).status, 200);
  assert.equal((await intake.fetch(event({ format: "video", id: crypto.randomUUID() }))).status, 200);
  assert.deepEqual(entries.get("stats:downloads"), { video: 1, gif: 1 });
  assert.equal((await intake.fetch(event({ format: "other", id }))).status, 400);
});

test("persistent template counts reach the protected dashboard and survive cleanup", async () => {
  const entries = new Map([["stats:downloads", { video: 8, gif: 4 }]]);
  const storage = {
    get: async (key) => structuredClone(entries.get(key)),
    put: async (key, value) => {
      if (typeof key === "object") for (const [name, item] of Object.entries(key)) entries.set(name, structuredClone(item));
      else entries.set(key, structuredClone(value));
    },
    list: async ({ prefix }) => new Map([...entries].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))),
    delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key); },
    transaction: async (fn) => fn(storage), getAlarm: async () => 123, setAlarm: async () => {}
  };
  const intakeEnv = { ...env, VISIT_COUNTER: {
    idFromName: (name) => name, get: () => ({ fetch: async () => Response.json({ today: 2, total: 10 }) })
  } };
  const intake = new EmailIntake({ storage }, intakeEnv);
  const record = (body) => intake.fetch(new Request(`${origin}/api/download-event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body)
  }));
  const id = crypto.randomUUID();
  assert.equal((await record({ id, format: "gif", template: "speed" })).status, 200);
  assert.equal((await record({ id, format: "video", template: "baby-boo" })).status, 200);
  assert.equal((await record({ id: crypto.randomUUID(), format: "video", template: "baby-boo" })).status, 200);
  assert.equal((await record({ id: crypto.randomUUID(), format: "gif", template: "invalid" })).status, 400);
  assert.deepEqual(entries.get("stats:download-templates"), { speed: { video: 0, gif: 1 }, "baby-boo": { video: 1, gif: 0 } });
  assert.equal((await intake.fetch(request("dashboard"))).status, 401);
  const login = await intake.fetch(request("login", { email: env.ADMIN_EMAIL, password }));
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  entries.set(`download:${id}`, 1);
  await intake.alarm();
  assert.equal(entries.has(`download:${id}`), false);
  // Recreate the object to verify aggregates come from durable storage.
  const restarted = new EmailIntake({ storage }, intakeEnv);
  const response = await restarted.fetch(request("dashboard", undefined, cookie));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.downloads, { video: 9, gif: 5 });
  assert.deepEqual(result.templateDownloads, [
    { id: "unknown", name: "Template not recorded", video: 8, gif: 4, total: 12 },
    { id: "baby-boo", name: "Baby Boo", video: 1, gif: 0, total: 1 },
    { id: "speed", name: "Speed", video: 0, gif: 1, total: 1 }
  ]);
});
