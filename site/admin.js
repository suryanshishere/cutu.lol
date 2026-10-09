const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const logout = document.querySelector("#logout");
const loginError = document.querySelector("#login-error");
const signIn = document.querySelector("#sign-in");
const refresh = document.querySelector("#refresh");
const status = document.querySelector("#dashboard-status");
const search = document.querySelector("#email-search");
let emails = [];
let loadVersion = 0;

async function api(path, body) {
  const response = await fetch(`/api/admin/${path}`, {
    cache: "no-store", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") showLogin("Your session ended. Sign in again.");
    throw new Error(result.error || "Couldn’t load admin data. Try again.");
  }
  return result;
}

function showLogin(message = "") {
  loadVersion += 1;
  emails = [];
  search.value = "";
  document.querySelector("#email-rows").replaceChildren();
  dashboard.hidden = true;
  logout.hidden = true;
  loginPanel.hidden = false;
  loginError.textContent = message;
  loginError.hidden = !message;
  document.querySelector("#admin-password").value = "";
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  logout.hidden = false;
  document.querySelector("#admin-password").value = "";
}

const dateFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const number = (value) => typeof value === "number" ? value.toLocaleString("en-IN") : "—";

function renderEmails() {
  const query = search.value.trim().toLowerCase();
  const filtered = emails.filter((entry) => entry.email.toLowerCase().includes(query));
  const rows = document.createDocumentFragment();
  for (const entry of filtered) {
    const row = document.createElement("tr");
    const email = document.createElement("td");
    const collected = document.createElement("td");
    email.textContent = entry.email;
    const date = new Date(entry.createdAt);
    collected.textContent = Number.isFinite(date.getTime()) ? dateFormat.format(date) : "—";
    row.append(email, collected);
    rows.append(row);
  }
  document.querySelector("#email-rows").replaceChildren(rows);
  const empty = document.querySelector("#empty-state");
  empty.hidden = filtered.length > 0;
  empty.textContent = query ? "No matching emails." : "No emails collected yet.";
  document.querySelector("#email-count").textContent = `${number(filtered.length)} of ${number(emails.length)} emails`;
}

async function loadDashboard() {
  const version = ++loadVersion;
  refresh.disabled = true;
  status.textContent = "Loading…";
  status.classList.remove("error");
  try {
    const collected = new Map();
    let offset = 0;
    do {
      const result = await api(`dashboard?offset=${offset}`);
      if (version !== loadVersion) return;
      document.querySelector("#email-total").textContent = number(result.totalEmails);
      document.querySelector("#visitors-today").textContent = number(result.visits.today);
      document.querySelector("#visitors-total").textContent = number(result.visits.total);
      document.querySelector("#downloads-total").textContent = number(result.downloads.video + result.downloads.gif);
      document.querySelector("#download-formats").textContent = `Video ${number(result.downloads.video)} · GIF ${number(result.downloads.gif)}`;
      for (const entry of result.emails) collected.set(entry.email, entry);
      emails = [...collected.values()];
      renderEmails();
      offset = result.nextOffset;
      status.textContent = offset === null ? `Updated ${dateFormat.format(new Date(result.updatedAt))}` : "Loading more emails…";
    } while (offset !== null);
  } catch (error) {
    if (version === loadVersion) { status.textContent = error.message; status.classList.add("error"); }
  } finally { if (version === loadVersion) refresh.disabled = false; }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (signIn.disabled) return;
  signIn.disabled = true;
  signIn.textContent = "Signing in…";
  loginError.hidden = true;
  try {
    await api("login", { email: document.querySelector("#admin-email").value.trim(), password: document.querySelector("#admin-password").value });
    showDashboard();
    await loadDashboard();
  } catch (error) { loginError.textContent = error.message; loginError.hidden = false; }
  finally { signIn.disabled = false; signIn.textContent = "Sign in"; }
});
logout.addEventListener("click", async () => {
  logout.disabled = true;
  try { await api("logout", {}); showLogin(); }
  catch (error) { status.textContent = error.message; status.classList.add("error"); }
  finally { logout.disabled = false; }
});
refresh.addEventListener("click", loadDashboard);
search.addEventListener("input", renderEmails);

signIn.disabled = true;
api("session").then(() => { showDashboard(); return loadDashboard(); }).catch((error) => {
  showLogin(error.message === "Please sign in." ? "" : error.message);
}).finally(() => { signIn.disabled = false; });

window.addEventListener("pageshow", (event) => {
  if (event.persisted) api("session").catch(() => showLogin());
});
