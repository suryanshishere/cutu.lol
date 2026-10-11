import { Resvg } from "@cf-wasm/resvg/workerd";
import { renderShareCard } from "./share-card.js";
import { applyPageMeta } from "./page-meta.js";
import { readMemeUrl } from "../site/memes.js";
import { handleEmailIntake } from "./email-intake.js";
import { adminPageHeaders, adminResponse, readAdminBody } from "./admin.js";
export { EmailIntake } from "./email-intake.js";
export { BrandBookings } from "./brand-bookings.js";

const SITE_COUNTER_NAME = "hamster-sitewide";
const VISITOR_COOKIE = "cutu_visitor";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function visitorIdFromCookie(header) {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VISITOR_COOKIE}=`))?.slice(VISITOR_COOKIE.length + 1);
  return value && UUID_PATTERN.test(value) ? value : null;
}

function indiaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export class VisitCounter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === "GET") {
      return Response.json(await this.readCounts(), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (request.method === "POST") {
      return Response.json(await this.recordVisit(await request.text()), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  async recordVisit(visitorId) {
    if (!UUID_PATTERN.test(visitorId)) throw new Error("Invalid visitor ID");
    const day = indiaDateKey();
    const visitorKey = `visitor:${visitorId}`;
    let counts;
    await this.state.storage.transaction(async (storage) => {
      const lastVisitDay = await storage.get(visitorKey);
      const total = (await storage.get("total")) || 0;
      const today = (await storage.get(`day:${day}`)) || 0;
      counts = {
        total: total + (lastVisitDay === undefined ? 1 : 0),
        today: today + (lastVisitDay === day ? 0 : 1),
        updatedAt: new Date().toISOString()
      };
      if (lastVisitDay !== day) {
        await storage.put({ [visitorKey]: day, total: counts.total, [`day:${day}`]: counts.today });
      }
    });
    return counts;
  }

  async readCounts() {
    const day = indiaDateKey();
    const values = await this.state.storage.get(["total", `day:${day}`]);
    return {
      today: values.get(`day:${day}`) || 0,
      total: values.get("total") || 0,
      updatedAt: new Date().toISOString()
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/brands/")) {
      try {
        const bookings = env.BRAND_BOOKINGS.get(env.BRAND_BOOKINGS.idFromName("sitewide-brands"));
        return await bookings.fetch(request);
      } catch { return Response.json({ error: "Brand bookings are temporarily unavailable. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
    }

    if (["/admin", "/admin/", "/admin.html"].includes(url.pathname)) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      const asset = await env.ASSETS.fetch(new URL("/admin.html", url));
      const headers = new Headers(asset.headers);
      for (const [name, value] of Object.entries(adminPageHeaders())) headers.set(name, value);
      return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, headers });
    }

    if (url.pathname.startsWith("/api/admin/") || url.pathname === "/api/download-event") {
      try {
        let body;
        if (request.method === "POST") {
          if (request.headers.get("Origin") !== url.origin) return adminResponse({ error: "Invalid origin." }, 403);
          const parsed = await readAdminBody(request);
          if (parsed.error) return parsed.error;
          body = JSON.stringify(parsed.value);
        }
        const headers = new Headers();
        for (const name of ["Cookie", "Origin", "CF-Connecting-IP", "Content-Type"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const intake = env.EMAIL_INTAKE.get(env.EMAIL_INTAKE.idFromName("download-emails"));
        return await intake.fetch(new Request(url, { method: request.method, headers, ...(body ? { body } : {}) }));
      } catch { return adminResponse({ error: "Temporarily unavailable. Try again." }, 503); }
    }

    if (url.pathname === "/api/email-intake") {
      return handleEmailIntake(request, async (email) => {
        const intake = env.EMAIL_INTAKE.get(env.EMAIL_INTAKE.idFromName("download-emails"));
        // Validate and consume the public request before forwarding a small,
        // normalized payload. Rejected bodies never reach the Durable Object.
        const response = await intake.fetch("https://email-intake/", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error("Email persistence failed");
      });
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/share-card.png") {
      const headers = {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff"
      };
      if (request.method === "HEAD") return new Response(null, { headers });
      const { meme, message } = readMemeUrl(url);
      const [stampResponse, fontResponse] = await Promise.all([
        env.ASSETS.fetch(new URL(meme.shareImage, url)),
        env.ASSETS.fetch(new URL("/share-lora.woff2", url))
      ]);
      if (!stampResponse.ok || !fontResponse.ok) return new Response("Share card assets unavailable", { status: 503 });
      const [stamp, font] = await Promise.all([stampResponse.arrayBuffer(), fontResponse.arrayBuffer()]);
      const png = await renderShareCard(message, new Uint8Array(stamp), new Uint8Array(font), Resvg, meme.id);
      return new Response(png, { headers });
    }

    const isPageLoad = ["GET", "HEAD"].includes(request.method) && (url.pathname === "/" || url.pathname === "/index.html");
    if (isPageLoad) {
      const assetResponse = await env.ASSETS.fetch(new Request(new URL("/", url)));
      if (!assetResponse.ok || !assetResponse.headers.get("content-type")?.includes("text/html")) {
        return assetResponse;
      }

      const existingVisitorId = visitorIdFromCookie(request.headers.get("Cookie"));
      const visitorId = existingVisitorId || crypto.randomUUID();
      const id = env.VISIT_COUNTER.idFromName(SITE_COUNTER_NAME);
      const counter = env.VISIT_COUNTER.get(id);
      const countResponse = await counter.fetch("https://visit-counter/", request.method === "HEAD" ? { method: "GET" } : { method: "POST", body: visitorId });
      const counts = await countResponse.json();

      const html = await assetResponse.text();
      const stats = `<script>window.__VISIT_STATS__=${JSON.stringify(counts)};</script>`;
      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      headers.delete("etag");
      headers.set("Cache-Control", "no-store");
      if (!existingVisitorId && request.method !== "HEAD") {
        headers.append("Set-Cookie", `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${url.protocol === "https:" ? "; Secure" : ""}`);
      }
      const publicOrigin = url.hostname === "cutu.suryansh.lol" ? "https://cutu.suryansh.lol" : url.origin;
      return new Response(request.method === "HEAD" ? null : applyPageMeta(html, url, publicOrigin).replace("</head>", `${stats}</head>`), {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
