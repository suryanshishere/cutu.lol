import { adminResponse, readAdminBody } from "./admin.js";
import { MEMES } from "../site/memes.js";

export const DOWNLOAD_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function handleDownloadEvent(request, recordEvent) {
  if (request.method !== "POST") return adminResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return adminResponse({ error: "Invalid origin." }, 403);
  const parsed = await readAdminBody(request);
  if (parsed.error) return parsed.error;
  const { format, id, template } = parsed.value;
  if (!["video", "gif"].includes(format) || typeof id !== "string" || !UUID_V4.test(id)
    || (template !== undefined && (typeof template !== "string" || !Object.hasOwn(MEMES, template)))) {
    return adminResponse({ error: "Invalid download event." }, 400);
  }
  await recordEvent({ format, id, ...(template !== undefined ? { template } : {}) });
  return adminResponse({ ok: true });
}

export function createMemoryDownloadStore() {
  const counts = { video: 0, gif: 0 };
  const templates = {};
  const events = new Map();
  return {
    readCounts: () => ({ ...counts }),
    readTemplates: () => structuredClone(templates),
    recordEvent({ format, id, template }, now = Date.now()) {
      for (const [key, time] of events) {
        if (time <= now - DOWNLOAD_EVENT_TTL_MS) events.delete(key);
      }
      if (events.has(id)) return;
      counts[format] += 1;
      if (template) {
        templates[template] ||= { video: 0, gif: 0 };
        templates[template][format] += 1;
      }
      events.set(id, now);
    }
  };
}

export function templateDownloadRows(downloads, templates = {}) {
  const rows = Object.values(MEMES).map(({ id, name }) => ({
    id, name, video: templates[id]?.video || 0, gif: templates[id]?.gif || 0
  }));
  const unknown = {
    id: "unknown", name: "Template not recorded",
    video: Math.max(0, downloads.video - rows.reduce((sum, row) => sum + row.video, 0)),
    gif: Math.max(0, downloads.gif - rows.reduce((sum, row) => sum + row.gif, 0))
  };
  if (unknown.video || unknown.gif) rows.push(unknown);
  return rows.map((row) => ({ ...row, total: row.video + row.gif }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
