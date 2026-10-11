import { hmacHex } from "./brand-bookings.js";
import { readJsonBody } from "./json-body.js";

// Used only by server.mjs --test-payments, never by the deployed Worker.
export function createLocalBrandPayments() {
  const data = new Map(), orders = new Map(), payments = new Map();
  const env = { RAZORPAY_KEY_ID: "local_simulated_checkout", RAZORPAY_KEY_SECRET: crypto.randomUUID() };
  const storage = {
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    delete: async key => data.delete(key),
    list: async ({ prefix }) => new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]))
  };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace("/v1/", "");
    if (path === "orders" && options.method === "POST") {
      const order = { ...JSON.parse(options.body), id: `order_${crypto.randomUUID().replaceAll("-", "")}` };
      orders.set(order.id, order); return Response.json(order);
    }
    if (/^orders\/[^/]+\/payments$/.test(path)) return Response.json({ items: [...payments.values()].filter(payment => payment.order_id === path.split("/")[1]) });
    if (/^payments\/[^/]+$/.test(path) && payments.has(path.split("/")[1])) return Response.json(payments.get(path.split("/")[1]));
    return Response.json({ error: "Unknown simulated payment." }, { status: 404 });
  };
  async function complete(request) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers });
    if (request.headers.get("Origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
    const parsed = await readJsonBody(request, { maxBytes: 1024 });
    const order = orders.get(parsed.value?.orderId);
    if (parsed.status || !order) return Response.json({ error: "Test order not found." }, { status: parsed.status || 404, headers });
    let payment = [...payments.values()].find(payment => payment.order_id === order.id);
    if (!payment) {
      payment = { id: `pay_${crypto.randomUUID().replaceAll("-", "")}`, order_id: order.id, amount: order.amount, currency: "INR", status: "captured", captured: true, amount_refunded: 0 };
      payments.set(payment.id, payment);
    }
    return Response.json({ razorpay_order_id: order.id, razorpay_payment_id: payment.id, razorpay_signature: await hmacHex(env.RAZORPAY_KEY_SECRET, `${order.id}|${payment.id}`) }, { headers });
  }
  return { env, storage, fetcher, complete };
}
