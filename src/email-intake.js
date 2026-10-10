import { createAdminStore, dashboardPage, handleAdminRequest } from "./admin.js";
import { readJsonBody } from "./json-body.js";
import { DOWNLOAD_EVENT_TTL_MS, handleDownloadEvent } from "./download-events.js";

const MAX_BODY_BYTES = 1024;

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const [local, domain] = email.split("@");
  if (!local || !domain || email.length > 254 || local.length > 64) return null;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) ? email : null;
}

function reply(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export async function handleEmailIntake(request, saveEmail) {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ error: "Please submit from this website." }, 403);
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (parsed.status) {
    const messages = { 415: "Send a JSON email address.", 413: "Request is too large.", 400: "Enter a valid email address." };
    return reply({ error: messages[parsed.status] }, parsed.status);
  }

  const email = normalizeEmail(parsed.value?.email);
  if (!email) return reply({ error: "Enter a valid email address, like you@example.com." }, 400);
  try {
    await saveEmail(email);
    return reply({ ok: true });
  } catch {
    return reply({ error: "Couldn’t save your email. Please try again." }, 503);
  }
}

export class EmailIntake {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    this.adminStore = createAdminStore(state.storage);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdminRequest(request, this.env, this.adminStore, async (offset) => {
        const emails = [];
        let startAfter;
        while (true) {
          const page = await this.state.storage.list({ prefix: "email:", limit: 1000, ...(startAfter ? { startAfter } : {}) });
          emails.push(...page.values());
          if (page.size < 1000) break;
          startAfter = [...page.keys()].at(-1);
        }
        const counter = this.env.VISIT_COUNTER.get(this.env.VISIT_COUNTER.idFromName("hamster-sitewide"));
        const counts = await counter.fetch("https://visit-counter/");
        if (!counts.ok) throw new Error("Counts unavailable");
        const downloads = (await this.state.storage.get("stats:downloads")) || { video: 0, gif: 0 };
        return { ...dashboardPage(emails, await counts.json(), offset), downloads };
      });
    }
    if (url.pathname === "/api/download-event") {
      return handleDownloadEvent(request, async ({ format, id }) => {
        await this.state.storage.transaction(async (storage) => {
          const key = `download:${id}`;
          if (await storage.get(key)) return;
          const counts = (await storage.get("stats:downloads")) || { video: 0, gif: 0 };
          counts[format] += 1;
          await storage.put({ "stats:downloads": counts, [key]: Date.now() });
        });
        if (!await this.state.storage.getAlarm()) await this.state.storage.setAlarm(Date.now() + DOWNLOAD_EVENT_TTL_MS);
      });
    }
    return handleEmailIntake(request, (email) => this.state.storage.transaction(async (storage) => {
      const key = `email:${email}`;
      if (await storage.get(key) === undefined) {
        await storage.put(key, { email, createdAt: new Date().toISOString() });
      }
    }));
  }

  async alarm() {
    const cutoff = Date.now() - DOWNLOAD_EVENT_TTL_MS;
    for (const prefix of ["download:", "admin:session:", "admin:attempt:"]) {
      let startAfter;
      while (true) {
        const page = await this.state.storage.list({ prefix, limit: 1000, ...(startAfter ? { startAfter } : {}) });
        const expired = [...page].filter(([, value]) => typeof value === "number" ? value <= cutoff : value.expiresAt <= Date.now()).map(([key]) => key);
        if (expired.length) await this.state.storage.delete(expired);
        if (page.size < 1000) break;
        startAfter = [...page.keys()].at(-1);
      }
    }
    await this.state.storage.setAlarm(Date.now() + DOWNLOAD_EVENT_TTL_MS);
  }
}
