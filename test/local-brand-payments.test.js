import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function start(t, args = []) {
  const child = spawn(process.execPath, ["server.mjs", ...args], { cwd: new URL("../", import.meta.url), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { child.kill(); if (child.exitCode === null) await once(child, "exit"); });
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Local server did not start")), 10000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.stdout.on("data", data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
}

test("local simulation accepts website-only branding, verifies payment and publishes without a logo upload", async t => {
  const address = await start(t, ["--test-payments"]);
  const post = (path, body, origin = address) => fetch(`${address}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const html = await (await fetch(address)).text();
  assert.match(html, /src="\/__local-payments\/checkout.js"/);
  const orderResponse = await post("/api/brands/order", { slot: 1, days: 8, name: "Local test", link: "https://example.com" });
  assert.equal(orderResponse.status, 200);
  const order = await orderResponse.json(); assert.equal(order.amount, 114286);
  const owned = { bookingId: order.bookingId, token: order.token };
  assert.equal((await (await post("/api/brands/status", owned)).json()).ok, false);
  assert.equal((await post("/__local-payments/complete", { orderId: order.orderId }, "https://other.example")).status, 403);
  assert.equal((await post("/__local-payments/complete", { orderId: "missing" })).status, 404);
  const payment = await (await post("/__local-payments/complete", { orderId: order.orderId })).json();
  assert.equal((await post("/api/brands/verify", { ...owned, ...payment, token: "wrong" })).status, 404);
  const receipt = await (await post("/api/brands/verify", { ...owned, ...payment })).json();
  assert.equal(receipt.ok, true); assert.equal(receipt.days, 8);
  const slots = await (await fetch(`${address}/api/brands/slots`)).json();
  assert.equal(slots.slots[0].brand.name, "Local test");
  assert.equal(slots.slots[0].brand.logo, "https://example.com/favicon.ico");
});

test("ordinary server never exposes simulated checkout or payment endpoints", async t => {
  const address = await start(t);
  assert.doesNotMatch(await (await fetch(address)).text(), /__local-payments/);
  assert.equal((await fetch(`${address}/__local-payments/checkout.js`)).status, 404);
  assert.equal((await fetch(`${address}/__local-payments/complete`, { method: "POST" })).status, 404);
});
