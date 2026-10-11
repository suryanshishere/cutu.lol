import { brandAmount, formatBrandAmount } from "./brand-pricing.js";
import { brandLogoUrl } from "./brand-logo.js";

const $ = id => document.getElementById(id);
const dialog = $("brand-dialog"), form = $("brand-form"), details = $("brand-details");
const pay = $("brand-pay"), check = $("brand-check"), error = $("brand-error");
const storageKey = "cutu-brand-booking";
let slots = [], ready = false, pending = null, busy = false, checkoutOpen = false, verifying = false, checkoutScript;
try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Session recovery is optional. */ }
// Ignore damaged recovery data instead of breaking the entire booking UI.
if (pending && (!Number.isInteger(pending.slot) || pending.slot < 1 || pending.slot > 4 || brandAmount(pending.days) === null || typeof pending.name !== "string" || !brandLogoUrl(pending.link) || !(typeof pending.bookingId === "string" && typeof pending.token === "string" || typeof pending.requestKey === "string" && /^[a-f0-9-]{36}$/.test(pending.requestKey)))) pending = null;
function savePending(value) { if (value) { const { logo: oldLogo, ...details } = value; value = details; } pending = value; try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Keep in memory if storage is unavailable. */ } $("brand-resume").hidden = !pending; }
function showError(message = "") { error.textContent = message; error.hidden = !message; }
async function api(action, body) {
  let response, result;
  try {
    response = await fetch(`/api/brands/${action}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000) });
    result = await response.json();
  } catch { throw new Error("Connection interrupted. Please retry; your checkout is saved."); }
  if (!response.ok) { const failure = new Error(result.error || "Could not complete your booking. Please retry."); failure.status = response.status; throw failure; }
  return result;
}
function date(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value); }
async function loadSlots() {
  const grid = $("brand-spots");
  try {
    const result = await api("slots"); slots = result.slots; ready = result.paymentsReady;
    const children = slots.map(spot => {
      const element = document.createElement(spot.brand ? "a" : "button");
      element.className = `brand-spot${spot.brand ? " is-booked" : ""}`;
      if (spot.brand) {
        element.href = spot.brand.link; element.target = "_blank"; element.rel = "sponsored noopener noreferrer";
        element.setAttribute("aria-label", `${spot.brand.name} (sponsor, opens in a new tab)`);
        const img = document.createElement("img"); img.src = spot.brand.logo || brandLogoUrl(spot.brand.link); img.alt = ""; img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => { img.hidden = true; }); element.append(img);
        const name = document.createElement("span"); name.textContent = spot.brand.name; element.append(name);
        const badge = document.createElement("small"); badge.textContent = "Sponsored"; element.append(badge);
      } else {
        element.type = "button"; element.dataset.brandSlot = spot.slot;
        element.disabled = !spot.available || !ready;
        element.setAttribute("aria-label", `Book brand spot ${spot.slot}${!spot.available ? ", currently reserved" : ""}`);
        const plus = document.createElement("span"); plus.className = "brand-plus"; plus.textContent = "+"; plus.setAttribute("aria-hidden", "true");
        const text = document.createElement("span"); text.textContent = spot.available ? "Add your brand" : "Reserved";
        if (!spot.available) element.title = `Available after ${date(spot.availableAt)}`;
        element.append(plus, text); element.addEventListener("click", () => open(spot.slot));
      }
      return element;
    });
    grid.replaceChildren(...children); grid.setAttribute("aria-busy", "false");
    $("brand-status").textContent = !ready ? "Brand bookings open soon." : slots.every(s => !s.available) ? "All spots are taken for now. Check back soon." : "";
    for (const option of $("brand-position").options) option.disabled = !slots[Number(option.value) - 1]?.available;
  } catch { grid.setAttribute("aria-busy", "false"); $("brand-status").textContent = "Couldn’t load brand spots. Retrying shortly."; }
}
function updateAmount() {
  const days = $("brand-days").valueAsNumber;
  const duration = `${days} ${days === 1 ? "day" : "days"}`;
  $("brand-days-value").textContent = duration;
  $("brand-days").setAttribute("aria-valuetext", duration);
  const amount = pending?.amount ?? brandAmount($("brand-days").valueAsNumber);
  $("brand-amount").textContent = amount === null ? "-" : formatBrandAmount(amount);
  pay.textContent = pending ? "Continue payment" : amount === null ? "Choose number of days" : `Pay ${formatBrandAmount(amount)}`;
  pay.disabled = busy || amount === null;
  check.disabled = busy;
  $("brand-new").disabled = busy;
  details.disabled = busy || Boolean(pending);
}
function open(slot) {
  showError(); $("brand-success").hidden = true; form.hidden = false;
  check.hidden = !pending?.bookingId; $("brand-new").hidden = !pending;
  if (pending) {
    $("brand-position").value = pending.slot; $("brand-days").value = pending.days;
    $("brand-name").value = pending.name || ""; $("brand-link").value = pending.link || "";
    $("brand-dialog-title").textContent = `Your booking · Spot ${pending.slot}`;
  } else { $("brand-position").value = slot; $("brand-dialog-title").textContent = "Book a brand spot"; }
  previewLogo();
  updateAmount(); if (!dialog.open) dialog.showModal();
}
function previewLogo() {
  const logo = brandLogoUrl($("brand-link").value);
  const preview = $("brand-logo-preview"); preview.replaceChildren(); preview.hidden = !logo;
  $("brand-logo-help").textContent = "Logo from your website";
  if (logo) {
    const image = document.createElement("img"); image.src = logo; image.alt = "Website logo preview"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      if (!preview.children.length || preview.children[0] !== image) return;
      preview.hidden = true; $("brand-logo-help").textContent = "No website icon found. Your brand name will show.";
    });
    preview.append(image);
  }
}
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) checkoutScript = new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js";
    const failed = () => { clearTimeout(timeout); script.remove(); checkoutScript = null; reject(new Error("Could not load Razorpay. Check your connection and retry.")); };
    const timeout = setTimeout(failed, 15000);
    script.onload = () => { if (!window.Razorpay) { failed(); return; } clearTimeout(timeout); resolve(); };
    script.onerror = failed;
    document.head.append(script);
  });
  return checkoutScript;
}
async function confirmed(result) {
  if (!result.ok) { showError("Payment has not been confirmed yet. If you paid, wait a moment and check again."); return; }
  savePending(null); form.hidden = true;
  const success = $("brand-success"); success.hidden = false;
  const queued = result.startsAt > Date.now() + 10000;
  if (result.expired) {
    success.textContent = `Your booking in spot ${result.slot} ended on ${date(result.endsAt)}. Paid ${formatBrandAmount(result.amount)} for ${result.days} days.`;
    if (!dialog.open) dialog.showModal(); await loadSlots(); return;
  }
  success.textContent = queued ? `Payment confirmed. Spot ${result.slot} is booked for ${result.days} days, from ${date(result.startsAt)} to ${date(result.endsAt)}.` : `Your logo is live in spot ${result.slot}! It stays until ${date(result.endsAt)}. Paid ${formatBrandAmount(result.amount)} for ${result.days} days.`;
  if (!dialog.open) dialog.showModal(); await loadSlots();
}
async function checkPayment() {
  if (!pending?.bookingId || busy) return;
  busy = true; check.disabled = true; updateAmount(); showError();
  try { await confirmed(await api("status", { bookingId: pending.bookingId, token: pending.token })); }
  catch (error) { missingBooking(error); showError(error.message); }
  finally { busy = false; check.disabled = false; updateAmount(); }
}
function missingBooking(failure) {
  if (failure.status !== 404) return;
  savePending(null); check.hidden = true; $("brand-new").hidden = true;
  $("brand-dialog-title").textContent = "Book a brand spot";
  failure.message = "This booking is no longer available. You can start a new booking.";
}
form.addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return;
  if (!pending) { $("brand-name").value = $("brand-name").value.trim(); $("brand-link").value = $("brand-link").value.trim(); }
  if (!pending && !form.reportValidity()) return;
  if (!pending) savePending({ slot: Number($("brand-position").value), days: $("brand-days").valueAsNumber, name: $("brand-name").value.trim(), link: $("brand-link").value, requestKey: crypto.randomUUID() });
  busy = true; updateAmount(); showError();
  try {
    if (pending.bookingId) {
      const status = await api("status", { bookingId: pending.bookingId, token: pending.token });
      if (status.ok) { await confirmed(status); return; }
    }
    await loadCheckout();
    if (!pending.bookingId) {
      const input = { ...pending };
      const order = await api("order", input); savePending({ ...input, ...order });
    }
    const booking = { ...pending };
    let checkoutFailure = "";
    details.disabled = true; check.hidden = false; $("brand-new").hidden = false;
    const checkout = new window.Razorpay({
      key: booking.keyId, order_id: booking.orderId, amount: booking.amount, currency: "INR", name: "cutu", description: `Brand spot ${booking.slot} · ${booking.days} days`, timeout: 15 * 60,
      theme: { color: "#171714" },
      handler: async payment => {
        if (pending?.bookingId !== booking.bookingId) return;
        checkoutOpen = false; verifying = true; busy = true; open(booking.slot); updateAmount(); showError();
        try { await confirmed(await api("verify", { bookingId: booking.bookingId, token: booking.token, ...payment })); }
        catch (error) { showError(`${error.message} Your booking is saved. Use Check payment to retry confirmation.`); }
        finally { verifying = false; busy = false; updateAmount(); }
      },
      modal: { ondismiss: () => { if (pending?.bookingId !== booking.bookingId || verifying) return; checkoutOpen = false; busy = false; open(booking.slot); showError(checkoutFailure); loadSlots(); } }
    });
    checkout.on("payment.failed", () => { checkoutFailure = "The payment did not complete. You can retry or use Check payment if your bank shows a debit."; showError(checkoutFailure); });
    // A modal dialog's top layer would block Razorpay's checkout iframe.
    dialog.close(); checkoutOpen = true; checkout.open();
  } catch (error) {
    checkoutOpen = false;
    if (!pending?.bookingId && [400, 409].includes(error.status)) savePending(null);
    missingBooking(error); open(pending?.slot || Number($("brand-position").value)); showError(error.message); await loadSlots();
  }
  finally { if (!checkoutOpen) busy = false; updateAmount(); }
});
let previewTimer;
$("brand-link").addEventListener("input", () => { clearTimeout(previewTimer); previewTimer = setTimeout(previewLogo, 350); });
$("brand-link").addEventListener("change", () => { clearTimeout(previewTimer); previewLogo(); });
$("brand-days").addEventListener("input", updateAmount);
$("brand-close").addEventListener("click", () => dialog.close());
$("brand-check").addEventListener("click", checkPayment);
$("brand-resume").addEventListener("click", () => { if (!pending || busy) return; open(pending.slot); checkPayment(); });
$("brand-new").addEventListener("click", () => { if (busy) return; savePending(null); form.reset(); previewLogo(); dialog.close(); loadSlots(); });
savePending(pending); loadSlots(); setInterval(loadSlots, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadSlots(); });
