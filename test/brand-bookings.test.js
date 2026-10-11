import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrandBookingService, BrandBookings, hmacHex, validateBrand } from "../src/brand-bookings.js";
import { createLocalBrandStore } from "../src/local-brand-store.js";
import { brandAmount } from "../site/brand-pricing.js";
import { brandLogoUrl } from "../site/brand-logo.js";

const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const input = { slot: 1, days: 7, name: "My brand", link: "https://example.com/hello" };
const env = { RAZORPAY_KEY_ID: "rzp_test_example", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "webhook-secret" };
function storage() {
  const data = new Map();
  return { data, get: async key => structuredClone(data.get(key)), put: async (key, value) => data.set(key, structuredClone(value)), delete: async key => data.delete(key), list: async ({ prefix }) => new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])) };
}
function fixture() {
  let now = 1800000000000, counter = 0;
  const store = storage(), orders = new Map(), payments = new Map(), calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers.Authorization, `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`);
    const path = url.replace("https://api.razorpay.com/v1/", "");
    if (path === "orders" && options.method === "POST") {
      const order = { ...JSON.parse(options.body), id: `order_${++counter}` }; orders.set(order.id, order); return Response.json(order);
    }
    const parts = path.split("/");
    if (parts[0] === "orders" && parts[2] === "payments") return Response.json({ items: [...payments.values()].filter(p => p.order_id === parts[1]) });
    if (parts[0] === "payments") {
      const payment = payments.get(parts[1]);
      if (!payment) return Response.json({}, { status: 404 });
      if (parts[2] === "capture") { assert.equal(JSON.parse(options.body).amount, payment.amount); payment.status = "captured"; payment.captured = true; }
      return Response.json(payment);
    }
    assert.fail(`Unexpected provider request: ${path}`);
  };
  const service = new BrandBookingService(store, env, { fetcher, now: () => now });
  const request = (action, body, overrides = {}) => new Request(`https://cutu.example/api/brands/${action}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: "https://cutu.example", "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...overrides });
  async function order(data = input) { const response = await service.handle(request("order", data)); assert.equal(response.status, 200); return response.json(); }
  function paid(order, status = "captured", patch = {}) {
    const payment = { id: `pay_${payments.size + 1}`, order_id: order.orderId, amount: order.amount, currency: "INR", status, captured: status === "captured", amount_refunded: 0, ...patch }; payments.set(payment.id, payment); return payment;
  }
  async function verify(order, payment) { return { bookingId: order.bookingId, token: order.token, razorpay_order_id: order.orderId, razorpay_payment_id: payment.id, razorpay_signature: await hmacHex(env.RAZORPAY_KEY_SECRET, `${order.orderId}|${payment.id}`) }; }
  return { service, store, orders, payments, calls, request, order, paid, verify, advance: value => { now += value; }, now: () => now };
}

test("brand pricing uses integer paise, exact weekly multiples and bounded whole days", () => {
  assert.equal(brandAmount(1), 14286); assert.equal(brandAmount(7), 100000); assert.equal(brandAmount(14), 200000); assert.equal(brandAmount(10), 142857);
  for (const days of [0, -1, 366, 1.5, "7", null, NaN, Infinity]) assert.equal(brandAmount(days), null);
});
test("brand validation requires a name and safe website, and ignores uploaded image data", () => {
  assert.equal(validateBrand({ ...input, name: " My brand " }).name, "My brand");
  for (const patch of [{ slot: 0 }, { slot: 5 }, { slot: "1" }, { days: 0 }, { name: "" }, { name: "a".repeat(61) }, { link: "" }, { link: "javascript:alert(1)" }, { link: "data:text/html,hello" }, { link: "https://a:b@example.com" }]) assert.throws(() => validateBrand({ ...input, ...patch }));
  assert.equal("logo" in validateBrand({ ...input, logo }), false);
  assert.equal(brandLogoUrl(input.link), "https://example.com/favicon.ico");
  for (const link of ["", "javascript:alert(1)", "https://a:b@example.com"]) assert.equal(brandLogoUrl(link), "");
});
test("orders calculate prices on the server, hold one of four slots and keep credentials private", async () => {
  const f = fixture(), order = await f.order({ ...input, amount: 1 });
  assert.equal(order.amount, 100000); assert.equal(f.orders.get(order.orderId).amount, 100000);
  const response = await f.service.handle(f.request("slots")); const body = await response.text();
  assert.equal(JSON.parse(body).slots.length, 4); assert.equal(JSON.parse(body).slots[0].available, false);
  assert.equal(body.includes(order.token), false); assert.equal(body.includes(env.RAZORPAY_KEY_SECRET), false);
  assert.equal([...f.store.data.keys()].some(key => key.startsWith("logo:")), false);
  assert.equal("logo" in await f.store.get(`booking:${order.bookingId}`), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("provider fetch is called without a service receiver, as required by Cloudflare", async () => {
  const f = fixture();
  const service = new BrandBookingService(f.store, env, {
    fetcher: function (...args) {
      assert.equal(this, undefined, "Native Worker fetch must not receive the booking service as this");
      return f.service.fetcher(...args);
    },
    now: f.now
  });
  const response = await service.handle(f.request("order", input));
  assert.equal(response.status, 200);
  assert.match((await response.json()).orderId, /^order_/);
  assert.equal(f.orders.size, 1);
});

test("concurrent buyers cannot reserve the same slot", async () => {
  const f = fixture(); const responses = await Promise.all([f.service.handle(f.request("order", input)), f.service.handle(f.request("order", input))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(f.orders.size, 1);
});

test("lost-response retries recover the same order without another charge attempt or rate-limit use", async () => {
  const f = fixture(), request = { ...input, requestKey: crypto.randomUUID() };
  const [first, second] = await Promise.all([f.order(request), f.order(request)]);
  assert.deepEqual(first, second); assert.equal(f.orders.size, 1);
  assert.equal((await f.service.records()).length, 1);
  assert.equal([...f.store.data].find(([key]) => key.startsWith("rate:"))[1], 1);
  const collision = await f.service.handle(f.request("order", { ...request, days: 14 }));
  assert.equal(collision.status, 409);
  assert.equal((await f.service.handle(f.request("order", { ...input, requestKey: "invalid" }))).status, 400);
  const privateSlots = await (await f.service.handle(f.request("slots"))).text();
  assert.equal(privateSlots.includes(request.requestKey), false);
  const payment = f.paid(first);
  await f.service.handle(f.request("verify", await f.verify(first, payment)));
  assert.deepEqual(await f.order(request), first, "Already-paid orders remain recoverable");
});

test("provider failures release the slot and leave checkout retryable", async () => {
  const f = fixture(), fetcher = f.service.fetcher;
  f.service.fetcher = async () => { throw new Error("Network interrupted"); };
  const response = await f.service.handle(f.request("order", { ...input, requestKey: crypto.randomUUID() }));
  assert.equal(response.status, 503);
  assert.equal((await f.service.slots())[0].available, true);
  assert.equal((await f.service.records()).length, 0);
  f.service.fetcher = fetcher;
  assert.ok((await f.order()).orderId);
});

test("expired paid runs report their end without becoming live again", async () => {
  const f = fixture(), order = await f.order(), payment = f.paid(order);
  await f.service.handle(f.request("verify", await f.verify(order, payment)));
  f.advance(8 * 86400000);
  const response = await f.service.handle(f.request("status", { bookingId: order.bookingId, token: order.token }));
  const receipt = await response.json(); assert.equal(receipt.ok, true); assert.equal(receipt.expired, true);
  assert.equal((await f.service.slots())[0].available, true);
});
test("payment verification checks ownership, signature, order, currency, amount and captured state", async () => {
  const f = fixture(), order = await f.order(), payment = f.paid(order), valid = await f.verify(order, payment);
  for (const patch of [{ token: "wrong" }, { razorpay_signature: "0".repeat(64) }, { razorpay_order_id: "order_fake" }, { razorpay_payment_id: "../orders" }]) assert.notEqual((await f.service.handle(f.request("verify", { ...valid, ...patch }))).status, 200);
  for (const patch of [{ amount: 1 }, { currency: "USD" }, { order_id: "order_other" }, { status: "created", captured: false }, { amount_refunded: 1 }]) {
    f.payments.set(payment.id, { ...payment, ...patch }); assert.notEqual((await f.service.handle(f.request("verify", valid))).status, 200);
    assert.equal((await f.service.slots())[0].brand, undefined);
  }
  f.payments.set(payment.id, payment); const success = await f.service.handle(f.request("verify", valid)); assert.equal(success.status, 200);
  const receipt = await success.json(); assert.equal(receipt.endsAt - receipt.startsAt, 7 * 86400000);
  assert.equal((await f.service.slots())[0].brand.name, input.name);
  assert.equal((await f.service.slots())[0].brand.logo, "https://example.com/favicon.ico");
  f.advance(60000); await f.service.handle(f.request("verify", valid));
  assert.equal((await f.store.get(`booking:${order.bookingId}`)).endsAt, receipt.endsAt, "Replay must not extend a booking");
  f.advance(7 * 86400000); assert.equal((await f.service.slots())[0].available, true); assert.equal((await f.service.slots())[0].brand, undefined);
});
test("authorized payments are captured before publication and status recovers closed checkouts", async () => {
  const f = fixture(), order = await f.order(); f.paid(order, "authorized");
  const result = await f.service.handle(f.request("status", { bookingId: order.bookingId, token: order.token })); assert.equal((await result.json()).ok, true);
  assert.ok(f.calls.some(call => call.url.endsWith("/capture"))); assert.ok((await f.service.slots())[0].brand);
});
test("unpaid holds expire, late paid bookings queue without losing duration or overlapping", async () => {
  const f = fixture(), first = await f.order(); f.advance(21 * 60000); assert.equal((await f.service.slots())[0].available, true);
  const second = await f.order(), secondPayment = f.paid(second); const verified = await f.service.handle(f.request("verify", await f.verify(second, secondPayment))); const receipt = await verified.json();
  const firstPayment = f.paid(first); const late = await f.service.handle(f.request("verify", await f.verify(first, firstPayment))); const lateReceipt = await late.json();
  assert.equal(lateReceipt.startsAt, receipt.endsAt); assert.equal(lateReceipt.endsAt - lateReceipt.startsAt, 7 * 86400000);
  f.advance(7 * 86400000); assert.ok((await f.service.slots())[0].brand);
});
test("signed webhook and reconciliation publish paid logos exactly once", async () => {
  const f = fixture(), order = await f.order(), payment = f.paid(order);
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: payment } } });
  const headers = { "Content-Type": "application/json", "X-Razorpay-Signature": await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw) };
  assert.equal((await f.service.handle(f.request("webhook", {}, { headers: { ...headers, "X-Razorpay-Signature": "0".repeat(64) }, body: raw }))).status, 400);
  const webhook = () => f.service.handle(f.request("webhook", {}, { headers, body: raw })); assert.equal((await webhook()).status, 200);
  const endsAt = (await f.store.get(`booking:${order.bookingId}`)).endsAt; f.advance(100000); assert.equal((await webhook()).status, 200); assert.equal((await f.store.get(`booking:${order.bookingId}`)).endsAt, endsAt);
  const other = await f.order({ ...input, slot: 2 }); f.paid(other); f.advance(60000); await f.service.sweep(); assert.ok((await f.service.slots())[1].brand);
});

test("webhook parse failures are rejected and unpaid reconciliation eventually stops scheduling", async () => {
  const f = fixture();
  for (const raw of ["{", "null", "[]"]) {
    const response = await f.service.handle(f.request("webhook", {}, { headers: { "X-Razorpay-Signature": await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw) }, body: raw }));
    assert.equal(response.status, 400);
  }
  const order = await f.order(); f.advance(31 * 86400000); await f.service.sweep();
  assert.equal((await f.store.get(`booking:${order.bookingId}`)).status, "expired");
  let alarm;
  f.store.setAlarm = async value => { alarm = value; };
  const object = new BrandBookings({ storage: f.store }, env); await object.schedule();
  assert.equal(alarm, undefined);
  const payment = f.paid(order);
  const verified = await f.service.handle(f.request("verify", await f.verify(order, payment)));
  assert.equal((await verified.json()).ok, true, "Late successful payment can still be recovered");
});
test("request guards and missing configuration do not call the payment provider", async () => {
  const f = fixture();
  for (const [request, status] of [[f.request("order", input, { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } }), 403], [f.request("order"), 405], [f.request("order", input, { body: "null" }), 400], [f.request("order", input, { body: "{" }), 400], [f.request("order", input, { body: "x".repeat(110001) }), 413], [f.request("order", input, { headers: { Origin: "https://cutu.example", "Content-Type": "text/plain" } }), 415]]) assert.equal((await f.service.handle(request)).status, status);
  const service = new BrandBookingService(storage(), {}); assert.equal((await service.handle(f.request("order", input))).status, 503); assert.equal(f.orders.size, 0);
});
test("checkout attempts are bounded and recover after the rate limit window", async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) { await f.order(); f.advance(21 * 60000); }
  // Use a fixed clock for the same rate-limit bucket.
  const g = fixture();
  for (let i = 0; i < 5; i++) { const order = await g.order(); const b = await g.store.get(`booking:${order.bookingId}`); b.holdUntil = 0; await g.store.put(`booking:${order.bookingId}`, b); }
  assert.equal((await g.service.handle(g.request("order", input))).status, 429); g.advance(3600000); assert.equal((await g.service.handle(g.request("order", input))).status, 200);
});
test("local bookings survive a service restart and Durable Object alarms are scheduled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cutu-brands-"));
  try {
    const store = createLocalBrandStore(join(directory, "brands.json"));
    await store.put("booking:one", { ...input, id: "one", status: "active", startsAt: 0, endsAt: Date.now() + 86400000 });
    const restarted = new BrandBookingService(createLocalBrandStore(join(directory, "brands.json")), env); assert.equal((await restarted.slots())[0].brand.name, input.name);
    const f = fixture(); const order = await f.order(); let alarm;
    f.store.setAlarm = async value => { alarm = value; };
    const object = new BrandBookings({ storage: f.store }, env); await object.schedule(); assert.ok(Number.isFinite(alarm)); assert.ok(await f.store.get(`booking:${order.bookingId}`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
