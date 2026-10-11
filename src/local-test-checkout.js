// Served only by the loopback development server in explicit simulation mode.
window.Razorpay = class LocalTestCheckout {
  constructor(options) { this.options = options; }
  on() {}
  open() {
    const modal = document.createElement("dialog");
    modal.className = "brand-dialog";
    const title = document.createElement("h2"); title.textContent = "Test payment";
    const note = document.createElement("p"); note.className = "brand-hint"; note.textContent = "Local simulation. No money will be charged.";
    const amount = document.createElement("p"); amount.textContent = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(this.options.amount / 100);
    const error = document.createElement("p"); error.setAttribute("role", "alert"); error.hidden = true;
    const pay = document.createElement("button"); pay.className = "modal-primary"; pay.textContent = "Complete test payment";
    const cancel = document.createElement("button"); cancel.className = "brand-text-button"; cancel.textContent = "Cancel";
    const dismiss = () => { modal.close(); modal.remove(); this.options.modal.ondismiss(); };
    cancel.addEventListener("click", dismiss);
    modal.addEventListener("cancel", event => { event.preventDefault(); dismiss(); });
    pay.addEventListener("click", async () => {
      pay.disabled = true; cancel.disabled = true; error.hidden = true;
      try {
        const response = await fetch("/__local-payments/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: this.options.order_id }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        modal.close(); modal.remove(); await this.options.handler(result);
      } catch (failure) { error.textContent = failure.message; error.hidden = false; pay.disabled = false; cancel.disabled = false; }
    });
    modal.append(title, note, amount, error, pay, cancel); document.body.append(modal); modal.showModal();
  }
};
const banner = document.createElement("p");
banner.textContent = "Local test mode — payments are simulated";
banner.style.cssText = "position:fixed;top:0;left:0;right:0;margin:0;padding:6px;text-align:center;background:#f2f1ed;color:#707070;z-index:100;font:14px sans-serif";
document.body.prepend(banner);
