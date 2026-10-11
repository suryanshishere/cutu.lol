import { BRAND_SLOTS, brandAmount } from "../site/brand-pricing.js";
import { brandLogoUrl } from "../site/brand-logo.js";
import { readJsonBody } from "./json-body.js";

const HOLD_MS = 20 * 60 * 1000;
const DAY_MS = 86400000;
const MAX_BODY = 110000;
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
class BookingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateBrand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BookingError("Choose a spot and add your brand details.");
  const { slot, days, name, link } = input;
  if (input.requestKey !== undefined && (typeof input.requestKey !== "string" || !/^[a-f0-9-]{36}$/.test(input.requestKey))) throw new BookingError("Invalid checkout request. Please start a new booking.");
  if (!Number.isInteger(slot) || slot < 1 || slot > BRAND_SLOTS) throw new BookingError("Choose one of the four spots.");
  const amount = brandAmount(days);
  if (amount === null) throw new BookingError("Choose 1 to 365 whole days.");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) throw new BookingError("Enter a brand name (up to 60 characters).");
  let url;
  try { url = new URL(link); } catch { throw new BookingError("Enter a complete website link, starting with https://."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 2000) throw new BookingError("Enter an http or https website link without login details.");
  return { slot, days, amount, name: name.trim(), link: url.href, ...(input.requestKey ? { requestKey: input.requestKey } : {}) };
}

export async function hmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function equalSignature(expected, actual) {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/.test(actual)) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

export class BrandBookingService {
  constructor(storage, env, { fetcher = fetch, now = Date.now } = {}) {
    this.storage = storage;
    this.env = env;
    this.fetcher = fetcher;
    this.now = now;
    this.queue = Promise.resolve();
  }
  exclusive(callback) {
    const result = this.queue.then(callback);
    this.queue = result.catch(() => {});
    return result;
  }
  async records() { return [...(await this.storage.list({ prefix: "booking:" })).values()]; }
  configured() { return Boolean(this.env.RAZORPAY_KEY_ID && this.env.RAZORPAY_KEY_SECRET); }
  async razorpay(path, method = "GET", body) {
    if (!this.configured()) throw new BookingError("Payments are being set up. Please try again later.", 503);
    const response = await this.fetcher(`https://api.razorpay.com/v1/${path}`, {
      method, headers: { Authorization: `Basic ${btoa(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`)}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new BookingError("Razorpay could not complete this step. Please retry.", 503);
    return response.json();
  }
  async slots() {
    const records = await this.records();
    const now = this.now();
    return Promise.all(Array.from({ length: BRAND_SLOTS }, async (_, i) => {
      const slot = i + 1;
      const active = records.find(b => b.slot === slot && b.status === "active" && b.startsAt <= now && b.endsAt > now);
      const holds = records.filter(b => b.slot === slot && ((b.status === "pending" && b.holdUntil > now) || (b.status === "active" && b.endsAt > now)));
      const availableAt = Math.max(now, ...holds.map(b => b.status === "pending" ? b.holdUntil : b.endsAt));
      return { slot, available: !holds.length, availableAt, ...(active ? { brand: { name: active.name, link: active.link, logo: active.logo || await this.storage.get(`logo:${active.id}`) || brandLogoUrl(active.link), endsAt: active.endsAt } } : {}) };
    }));
  }
  async create(input, ip) {
    const brand = validateBrand(input);
    if (!this.configured()) throw new BookingError("Payments are being set up. Please try again later.", 503);
    // Retrying a lost response must return the original order, not reserve again.
    if (brand.requestKey) {
      const existing = (await this.records()).find(booking => booking.requestKey === brand.requestKey);
      if (existing) {
        if (["slot", "days", "name", "link"].some(key => existing[key] !== brand[key])) throw new BookingError("This checkout already has different details. Start a new booking.", 409);
        return this.orderDetails(existing);
      }
    }
    const now = this.now();
    const hour = Math.floor(now / 3600000);
    const rateKey = `rate:${await hmacHex(this.env.RAZORPAY_KEY_SECRET, `${ip}:${hour}`)}`;
    const count = await this.storage.get(rateKey) || 0;
    if (count >= 5) throw new BookingError("Too many checkout attempts. Please try again in an hour.", 429);
    const slot = (await this.slots())[brand.slot - 1];
    if (!slot.available) throw new BookingError("This spot was just taken. Please choose another spot.", 409);
    const booking = { ...brand, id: crypto.randomUUID(), token: crypto.randomUUID(), status: "pending", createdAt: now, holdUntil: now + HOLD_MS, nextCheck: now + 60000 };
    // A single queue serializes the availability check, Razorpay call and persistence.
    const order = await this.razorpay("orders", "POST", { amount: brand.amount, currency: "INR", receipt: booking.id, notes: { booking_id: booking.id, slot: String(brand.slot), days: String(brand.days) } });
    if (!/^order_[A-Za-z0-9]+$/.test(order.id) || order.amount !== brand.amount || order.currency !== "INR") throw new BookingError("Could not create a payment order. Please retry.", 503);
    booking.orderId = order.id;
    await this.storage.put(`booking:${booking.id}`, booking);
    await this.storage.put(rateKey, count + 1);
    await this.storage.put(`rate-hour:${rateKey}`, hour);
    return this.orderDetails(booking);
  }
  orderDetails(booking) { return { bookingId: booking.id, token: booking.token, orderId: booking.orderId, keyId: this.env.RAZORPAY_KEY_ID, amount: booking.amount, currency: "INR", holdUntil: booking.holdUntil }; }
  async activate(booking, payment) {
    if (payment.order_id !== booking.orderId || payment.amount !== booking.amount || payment.currency !== "INR") throw new BookingError("Payment details do not match this booking.", 400);
    if (payment.status === "authorized") payment = await this.razorpay(`payments/${payment.id}/capture`, "POST", { amount: booking.amount, currency: "INR" });
    if (payment.status !== "captured" || payment.captured !== true || payment.amount_refunded > 0 || payment.order_id !== booking.orderId || payment.amount !== booking.amount || payment.currency !== "INR") return false;
    if (booking.status === "active") return true;
    // Rare late payments retain their full duration and queue behind an already paid run.
    const other = (await this.records()).filter(b => b.id !== booking.id && b.slot === booking.slot && b.status === "active");
    booking.startsAt = Math.max(this.now(), ...other.map(b => b.endsAt));
    booking.endsAt = booking.startsAt + booking.days * DAY_MS;
    booking.status = "active";
    booking.paymentId = payment.id;
    delete booking.nextCheck;
    await this.storage.put(`booking:${booking.id}`, booking);
    return true;
  }
  receipt(booking) { return { ok: booking.status === "active", status: booking.status, expired: booking.status === "active" && booking.endsAt <= this.now(), slot: booking.slot, days: booking.days, amount: booking.amount, startsAt: booking.startsAt, endsAt: booking.endsAt }; }
  async owned(input) {
    if (!input || typeof input.bookingId !== "string" || typeof input.token !== "string") throw new BookingError("Booking not found.", 404);
    const booking = await this.storage.get(`booking:${input.bookingId}`);
    if (!booking || booking.token !== input.token) throw new BookingError("Booking not found.", 404);
    return booking;
  }
  async reconcile(booking) {
    if (!["pending", "expired"].includes(booking.status)) return;
    const payments = await this.razorpay(`orders/${booking.orderId}/payments`);
    for (const payment of payments.items || []) {
      if (["authorized", "captured"].includes(payment.status) && await this.activate(booking, payment)) return;
    }
  }
  async verify(input) {
    const booking = await this.owned(input);
    if (!/^pay_[A-Za-z0-9]+$/.test(input.razorpay_payment_id) || input.razorpay_order_id !== booking.orderId || !equalSignature(await hmacHex(this.env.RAZORPAY_KEY_SECRET, `${booking.orderId}|${input.razorpay_payment_id}`), input.razorpay_signature)) throw new BookingError("Payment verification failed. Please retry confirmation.");
    const payment = await this.razorpay(`payments/${input.razorpay_payment_id}`);
    if (!await this.activate(booking, payment)) throw new BookingError("Payment is still processing. Use Check payment to confirm it.", 409);
    return this.receipt(booking);
  }
  async webhook(request) {
    if (!this.env.RAZORPAY_WEBHOOK_SECRET) throw new BookingError("Webhook is not configured.", 503);
    if (Number(request.headers.get("Content-Length")) > MAX_BODY) throw new BookingError("Request too large.", 413);
    // Read as bounded bytes without changing the original signed payload.
    const reader = request.body?.getReader();
    if (!reader) throw new BookingError("Invalid webhook.");
    const chunks = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BODY) throw new BookingError("Request too large.", 413); chunks.push(value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!equalSignature(await hmacHex(this.env.RAZORPAY_WEBHOOK_SECRET, raw), request.headers.get("X-Razorpay-Signature"))) throw new BookingError("Invalid webhook signature.", 400);
    let event;
    try { event = JSON.parse(raw); } catch { throw new BookingError("Invalid webhook."); }
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new BookingError("Invalid webhook.");
    const payment = event.payload?.payment?.entity;
    if (["payment.authorized", "payment.captured", "order.paid"].includes(event.event) && payment?.order_id) {
      const booking = (await this.records()).find(b => b.orderId === payment.order_id);
      if (booking) await this.activate(booking, await this.razorpay(`payments/${payment.id}`));
    }
    return { ok: true };
  }
  async handle(request) {
    return this.exclusive(async () => {
      try {
        const url = new URL(request.url);
        const action = url.pathname.split("/").at(-1);
        if (action === "slots" && request.method === "GET") return json({ slots: await this.slots(), paymentsReady: this.configured() });
        if (!["order", "verify", "status", "webhook"].includes(action)) return json({ error: "Not found." }, 404);
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
        if (action === "webhook") return json(await this.webhook(request));
        if (request.headers.get("Origin") !== url.origin) return json({ error: "Invalid origin." }, 403);
        const parsed = await readJsonBody(request, { maxBytes: action === "order" ? MAX_BODY : 2048 });
        if (parsed.status) return json({ error: "Invalid or oversized request." }, parsed.status);
        if (action === "order") return json(await this.create(parsed.value, request.headers.get("CF-Connecting-IP") || "local"));
        if (action === "verify") return json(await this.verify(parsed.value));
        const booking = await this.owned(parsed.value);
        await this.reconcile(booking);
        return json(this.receipt(booking));
      } catch (error) { return json({ error: error instanceof BookingError ? error.message : "Payments are temporarily unavailable. Please retry." }, error instanceof BookingError ? error.status : 503); }
    });
  }
  async sweep() {
    return this.exclusive(async () => {
      const now = this.now();
      for (const booking of await this.records()) {
        if (booking.status !== "pending" || booking.nextCheck > now) continue;
        try { await this.reconcile(booking); } catch { /* Retry provider failures without dropping the booking. */ }
        if (booking.status === "pending") {
          if (now - booking.createdAt > 30 * DAY_MS) { booking.status = "expired"; delete booking.nextCheck; await this.storage.put(`booking:${booking.id}`, booking); continue; }
          booking.nextCheck = now + (now - booking.createdAt < DAY_MS ? 5 * 60000 : DAY_MS);
          await this.storage.put(`booking:${booking.id}`, booking);
        }
      }
      for (const [key, hour] of await this.storage.list({ prefix: "rate-hour:" })) {
        if (hour < Math.floor(now / 3600000) - 1) { await this.storage.delete(key.slice(10)); await this.storage.delete(key); }
      }
    });
  }
}

export class BrandBookings {
  constructor(state, env) { this.state = state; this.service = new BrandBookingService(state.storage, env); }
  async schedule() {
    const pending = (await this.service.records()).filter(b => b.status === "pending" && Number.isFinite(b.nextCheck));
    if (pending.length) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...pending.map(b => b.nextCheck))));
  }
  async fetch(request) { const response = await this.service.handle(request); await this.schedule(); return response; }
  async alarm() { await this.service.sweep(); await this.schedule(); }
}
