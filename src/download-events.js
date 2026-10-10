import { adminResponse, readAdminBody } from "./admin.js";

export const DOWNLOAD_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function handleDownloadEvent(request, recordEvent) {
  if (request.method !== "POST") return adminResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return adminResponse({ error: "Invalid origin." }, 403);
  const parsed = await readAdminBody(request);
  if (parsed.error) return parsed.error;
  const { format, id } = parsed.value;
  if (!["video", "gif"].includes(format) || typeof id !== "string" || !UUID_V4.test(id)) {
    return adminResponse({ error: "Invalid download event." }, 400);
  }
  await recordEvent({ format, id });
  return adminResponse({ ok: true });
}

export function createMemoryDownloadStore() {
  const counts = { video: 0, gif: 0 };
  const events = new Map();
  return {
    readCounts: () => ({ ...counts }),
    recordEvent({ format, id }, now = Date.now()) {
      for (const [key, time] of events) {
        if (time <= now - DOWNLOAD_EVENT_TTL_MS) events.delete(key);
      }
      if (events.has(id)) return;
      counts[format] += 1;
      events.set(id, now);
    }
  };
}
