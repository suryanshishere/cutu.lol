const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
const COOKIE = "cutu_admin";
const encoder = new TextEncoder();

export function adminResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow", ...headers
  } });
}

export async function readAdminBody(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { error: adminResponse({ error: "Send JSON." }, 415) };
  }
  if (Number(request.headers.get("Content-Length")) > 2048) return { error: adminResponse({ error: "Request too large." }, 413) };
  try {
    const reader = request.body?.getReader();
    if (!reader) return { value: {} };
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) return { error: adminResponse({ error: "Request too large." }, 413) };
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON");
    return { value };
  } catch { return { error: adminResponse({ error: "Invalid request." }, 400) }; }
}

function hex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function unhex(value) { return new Uint8Array(value.match(/../g).map((byte) => parseInt(byte, 16))); }
async function digest(value) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }

export async function hashAdminPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

export async function verifyAdminPassword(password, stored) {
  if (typeof password !== "string" || password.length > 256 || !/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored || "")) return false;
  const actual = await hashAdminPassword(password, unhex(stored.split("$")[2]));
  let different = actual.length ^ stored.length;
  for (let index = 0; index < stored.length; index += 1) different |= actual.charCodeAt(index) ^ stored.charCodeAt(index);
  return different === 0;
}

export function createAdminStore(storage) {
  return {
    async attempt(key, now) {
      return storage.transaction(async (transaction) => {
        const name = `admin:attempt:${key}`;
        let attempts = await transaction.get(name);
        if (!attempts || attempts.expiresAt <= now) attempts = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) return Math.max(1, Math.ceil((attempts.expiresAt - now) / 1000));
        attempts.count += 1;
        await transaction.put(name, attempts);
        return 0;
      });
    },
    clearAttempts: (key) => storage.delete(`admin:attempt:${key}`),
    getSession: (key) => storage.get(`admin:session:${key}`),
    setSession: (key, session) => storage.put(`admin:session:${key}`, session),
    deleteSession: (key) => storage.delete(`admin:session:${key}`)
  };
}

export function createMemoryAdminStore() {
  const values = new Map();
  let pending = Promise.resolve();
  const storage = {
    get: async (key) => values.get(key), put: async (key, value) => { values.set(key, value); },
    delete: async (key) => values.delete(key),
    transaction(callback) {
      const operation = pending.then(() => callback(storage));
      pending = operation.catch(() => {});
      return operation;
    }
  };
  return createAdminStore(storage);
}

function sessionCookie(request, token, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

async function sessionKey(request) {
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return cookie && /^[a-f0-9]{64}$/.test(cookie) ? digest(cookie) : null;
}

export async function handleAdminRequest(request, env, store, readDashboard, now = Date.now()) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const routes = { "/api/admin/login": "POST", "/api/admin/logout": "POST", "/api/admin/session": "GET", "/api/admin/dashboard": "GET" };
  if (!routes[path]) return adminResponse({ error: "Not found." }, 404);
  if (request.method !== routes[path]) return adminResponse({ error: "Method not allowed." }, 405, { Allow: routes[path] });
  if (!env.ADMIN_EMAIL || !/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_HASH || "")) {
    return adminResponse({ error: "Admin login is not configured." }, 503);
  }
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin) return adminResponse({ error: "Please use the admin page to sign in." }, 403);
  try {
    const fingerprint = await digest(`${env.ADMIN_EMAIL}:${env.ADMIN_PASSWORD_HASH}`);
    if (path === "/api/admin/login") {
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const attemptKey = await digest(ip);
      const retryAfter = await store.attempt(attemptKey, now);
      if (retryAfter) return adminResponse({ error: "Too many attempts. Try again in 15 minutes." }, 429, { "Retry-After": String(retryAfter) });
      const parsed = await readAdminBody(request);
      if (parsed.error) return parsed.error;
      const { email, password } = parsed.value;
      const validPassword = await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH);
      if (typeof email !== "string" || email.trim().toLowerCase() !== env.ADMIN_EMAIL.trim().toLowerCase() || !validPassword) {
        return adminResponse({ error: "Email or password is incorrect." }, 401);
      }
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      await store.setSession(await digest(token), { expiresAt: now + SESSION_SECONDS * 1000, fingerprint });
      await store.clearAttempts(attemptKey);
      return adminResponse({ ok: true, email: env.ADMIN_EMAIL }, 200, { "Set-Cookie": sessionCookie(request, token) });
    }

    const key = await sessionKey(request);
    if (path === "/api/admin/logout") {
      if (key) await store.deleteSession(key);
      return adminResponse({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
    }
    const session = key ? await store.getSession(key) : null;
    if (!session || session.expiresAt <= now || session.fingerprint !== fingerprint) {
      if (key) await store.deleteSession(key);
      return adminResponse({ error: "Please sign in." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });
    }
    if (path === "/api/admin/session") return adminResponse({ authenticated: true, email: env.ADMIN_EMAIL });
    const rawOffset = url.searchParams.get("offset") || "0";
    if (!/^\d{1,7}$/.test(rawOffset)) return adminResponse({ error: "Invalid page." }, 400);
    return adminResponse(await readDashboard(Number(rawOffset)));
  } catch { return adminResponse({ error: "Admin data is temporarily unavailable. Try again." }, 503); }
}

export function dashboardPage(emails, visits, offset = 0) {
  const sorted = [...emails].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.email.localeCompare(b.email));
  return {
    emails: sorted.slice(offset, offset + 100),
    totalEmails: sorted.length,
    visits,
    nextOffset: offset + 100 < sorted.length ? offset + 100 : null,
    updatedAt: new Date().toISOString()
  };
}

export function adminPageHeaders() {
  return {
    "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
}
