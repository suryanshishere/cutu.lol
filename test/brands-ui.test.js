import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandBookingService, hmacHex } from "../src/brand-bookings.js";

async function fixture(t, recovery = null) {
  const globals = ["document", "window", "sessionStorage", "fetch", "setInterval"];
  const previous = globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  class Element {
    constructor(tag = "div") { this.tag = tag; this.hidden = false; this.disabled = false; this.value = ""; this.listeners = {}; this.children = []; this.options = []; this.files = []; this.open = false; this.dataset = {}; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    async dispatch(type) { await this.listeners[type]?.({ preventDefault() {} }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    reportValidity() { return true; }
    reset() { el("brand-days").value = "7"; el("brand-name").value = ""; el("brand-link").value = ""; }
    get valueAsNumber() { return Number(this.value); }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el("brand-days").value = "7";
  el("brand-position").options = [1, 2, 3, 4].map(value => ({ value: String(value) }));
  el("brand-name").value = "Advertiser"; el("brand-link").value = "https://example.com";
  const stored = new Map(), entries = new Map(), payments = new Map();
  if (recovery) stored.set("cutu-brand-booking", JSON.stringify(recovery));
  const controls = { dropOrderResponse: false, verifyGate: null };
  let providerOrders = 0, opened = 0;
  const env = { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "ui-test-secret" };
  const service = new BrandBookingService({
    get: async key => structuredClone(entries.get(key)), put: async (key, value) => entries.set(key, structuredClone(value)),
    list: async ({ prefix }) => new Map([...entries].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]))
  }, env, { fetcher: async (url, options) => {
    if (url.endsWith("/orders")) { providerOrders++; const data = JSON.parse(options.body); return Response.json({ id: "order_ui1", ...data }); }
    if (url.endsWith("/payments")) return Response.json({ items: [...payments.values()] });
    if (url.endsWith("/payments/pay_ui1")) return Response.json(payments.get("pay_ui1"));
    assert.fail(`Unexpected request ${url}`);
  } });
  const requests = [];
  let latestCheckout;
  globalThis.document = { getElementById: el, createElement: tag => new Element(tag), addEventListener() {}, head: new Element("head") };
  globalThis.window = { Razorpay: class {
    constructor(options) { this.options = options; this.events = {}; latestCheckout = this; }
    on(name, handler) { this.events[name] = handler; }
    open() { opened++; assert.equal(el("brand-dialog").open, false, "The dialog must close before Razorpay opens"); }
  } };
  globalThis.sessionStorage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  globalThis.setInterval = () => 0;
  globalThis.fetch = async (url, options = {}) => {
    requests.push(url);
    if (url.endsWith("/verify") && controls.verifyGate) await controls.verifyGate;
    const response = await service.handle(new Request(`https://cutu.example${url}`, { ...options, headers: { ...options.headers, Origin: "https://cutu.example" } }));
    if (url.endsWith("/order") && controls.dropOrderResponse) { controls.dropOrderResponse = false; throw new Error("Response lost after order creation"); }
    return response;
  };
  await import(`../site/brands.js?test=${crypto.randomUUID()}`);
  for (let i = 0; i < 20 && !el("brand-spots").children.length; i++) await new Promise(resolve => setImmediate(resolve));
  return { el, service, stored, entries, payments, env, requests, controls, getCheckout: () => latestCheckout, getOrderCount: () => providerOrders, getOpenCount: () => opened };
}

test("brand form recovers a lost order response, preserves errors, prevents verification races and publishes only after payment", async t => {
  const { el, service, stored, entries, payments, env, requests, controls, getCheckout, getOrderCount } = await fixture(t);
  assert.equal(el("brand-spots").children.length, 4);
  await el("brand-spots").children[2].dispatch("click"); assert.equal(el("brand-position").value, 3);
  el("brand-days").value = "14"; await el("brand-days").dispatch("input"); assert.match(el("brand-amount").textContent, /2,000/);
  assert.equal(el("brand-days-value").textContent, "14 days");
  assert.equal(el("brand-days")["aria-valuetext"], "14 days");
  await el("brand-link").dispatch("change");
  assert.equal(el("brand-logo-preview").hidden, false);
  assert.equal(el("brand-logo-preview").children[0].src, "https://example.com/favicon.ico");
  await el("brand-logo-preview").children[0].dispatch("error");
  assert.equal(el("brand-logo-preview").hidden, true);
  assert.match(el("brand-logo-help").textContent, /brand name will show/);
  controls.dropOrderResponse = true;
  await el("brand-form").dispatch("submit");
  assert.equal(getCheckout(), undefined);
  assert.match(el("brand-error").textContent, /Connection interrupted/);
  const draft = JSON.parse(stored.get("cutu-brand-booking"));
  assert.ok(draft.requestKey); assert.equal(draft.bookingId, undefined);
  assert.equal(el("brand-details").disabled, true);
  await el("brand-form").dispatch("submit");
  assert.equal(getOrderCount(), 1, "A lost response must not create another provider order");
  assert.equal(getCheckout().options.amount, 200000); assert.equal(getCheckout().options.currency, "INR"); assert.equal(getCheckout().options.order_id, "order_ui1");
  assert.ok(stored.has("cutu-brand-booking")); assert.equal(el("brand-details").disabled, true);
  assert.equal("logo" in JSON.parse(stored.get("cutu-brand-booking")), false);
  assert.equal([...entries.keys()].some(key => key.startsWith("logo:")), false);
  getCheckout().events["payment.failed"](); getCheckout().options.modal.ondismiss(); assert.equal(el("brand-dialog").open, true);
  assert.match(el("brand-error").textContent, /payment did not complete/);
  await el("brand-check").dispatch("click"); assert.match(el("brand-error").textContent, /not been confirmed/);
  assert.equal((await service.slots())[2].brand, undefined);
  await el("brand-form").dispatch("submit"); assert.equal(requests.filter(url => url.endsWith("/order")).length, 2, "Continuing checkout must reuse the recovered order");
  payments.set("pay_ui1", { id: "pay_ui1", order_id: "order_ui1", amount: 200000, currency: "INR", status: "captured", captured: true, amount_refunded: 0 });
  let releaseVerify;
  controls.verifyGate = new Promise(resolve => { releaseVerify = resolve; });
  const verification = getCheckout().options.handler({ razorpay_order_id: "order_ui1", razorpay_payment_id: "pay_ui1", razorpay_signature: await hmacHex(env.RAZORPAY_KEY_SECRET, "order_ui1|pay_ui1") });
  assert.equal(el("brand-new").disabled, true); assert.equal(el("brand-pay").disabled, true);
  getCheckout().options.modal.ondismiss();
  assert.equal(el("brand-new").disabled, true, "Dismissal cannot unlock a verification in progress");
  await el("brand-new").dispatch("click"); assert.ok(stored.has("cutu-brand-booking"));
  releaseVerify(); await verification;
  assert.equal(el("brand-form").hidden, true); assert.match(el("brand-success").textContent, /logo is live in spot 3/); assert.equal(stored.size, 0);
  assert.equal(el("brand-spots").children[2].tag, "a"); assert.equal(el("brand-spots").children[2].href, "https://example.com/"); assert.match(el("brand-spots").children[2].rel, /sponsored/);
  assert.equal(el("brand-spots").children[2].children[0].src, "https://example.com/favicon.ico");
  await el("brand-spots").children[2].children[0].dispatch("error");
  assert.equal(el("brand-spots").children[2].children[0].hidden, true);
  assert.equal(el("brand-spots").children[2].children[1].textContent, "Advertiser");
  getCheckout().options.modal.ondismiss(); assert.equal(el("brand-form").hidden, true, "A late dismiss event must not erase the receipt");
});

test("saved drafts recover after reload and already-paid checkout resumes with its receipt", async t => {
  const draft = { slot: 2, days: 7, name: "Recovered brand", link: "https://example.com", requestKey: crypto.randomUUID() };
  const { el, payments, env, service, stored, getCheckout, getOpenCount } = await fixture(t, draft);
  await el("brand-spots").children[1].dispatch("click");
  assert.equal(el("brand-name").value, draft.name); assert.equal(el("brand-details").disabled, true);
  await el("brand-form").dispatch("submit");
  const booking = JSON.parse(stored.get("cutu-brand-booking")); getCheckout().options.modal.ondismiss();
  payments.set("pay_ui1", { id: "pay_ui1", order_id: booking.orderId, amount: booking.amount, currency: "INR", status: "captured", captured: true, amount_refunded: 0 });
  await service.handle(new Request("https://cutu.example/api/brands/verify", { method: "POST", headers: { Origin: "https://cutu.example", "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: booking.bookingId, token: booking.token, razorpay_order_id: booking.orderId, razorpay_payment_id: "pay_ui1", razorpay_signature: await hmacHex(env.RAZORPAY_KEY_SECRET, `${booking.orderId}|pay_ui1`) }) }));
  await el("brand-form").dispatch("submit");
  assert.equal(getOpenCount(), 1, "An already-paid order must not reopen checkout");
  assert.equal(el("brand-form").hidden, true); assert.equal(stored.size, 0);
});

test("missing bookings and corrupt recovery data leave the form usable", async t => {
  const recovery = { slot: 1, days: 7, name: "Old test", link: "https://example.com", bookingId: "missing", token: "missing" };
  const { el, getCheckout, stored } = await fixture(t, recovery);
  await el("brand-spots").children[0].dispatch("click"); await el("brand-form").dispatch("submit");
  assert.equal(getCheckout(), undefined); assert.equal(stored.size, 0);
  assert.equal(el("brand-details").disabled, false); assert.equal(el("brand-pay").disabled, false);
  assert.match(el("brand-error").textContent, /start a new booking/);
});

test("damaged session recovery does not block a fresh booking", async t => {
  const { el, stored } = await fixture(t, { slot: 99, days: "invalid" });
  assert.equal(stored.size, 0); assert.equal(el("brand-resume").hidden, true);
  await el("brand-spots").children[0].dispatch("click"); assert.equal(el("brand-details").disabled, false);
});
