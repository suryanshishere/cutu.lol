import { Resvg } from "@cf-wasm/resvg/workerd";
import { applyShareMeta, renderShareCard, shareText } from "./share-card.js";

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

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/share-card.png") {
      const headers = {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff"
      };
      if (request.method === "HEAD") return new Response(null, { headers });
      const [stampResponse, fontResponse] = await Promise.all([
        env.ASSETS.fetch(new URL("/share-stamp.png", url)),
        env.ASSETS.fetch(new URL("/share-lora.woff2", url))
      ]);
      if (!stampResponse.ok || !fontResponse.ok) return new Response("Share card assets unavailable", { status: 503 });
      const [stamp, font] = await Promise.all([stampResponse.arrayBuffer(), fontResponse.arrayBuffer()]);
      const png = await renderShareCard(shareText(url.searchParams.get("text")), new Uint8Array(stamp), new Uint8Array(font), Resvg);
      return new Response(png, { headers });
    }

    const isPageLoad = request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html");
    if (isPageLoad) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (!assetResponse.ok || !assetResponse.headers.get("content-type")?.includes("text/html")) {
        return assetResponse;
      }

      const existingVisitorId = visitorIdFromCookie(request.headers.get("Cookie"));
      const visitorId = existingVisitorId || crypto.randomUUID();
      const id = env.VISIT_COUNTER.idFromName(SITE_COUNTER_NAME);
      const counter = env.VISIT_COUNTER.get(id);
      const countResponse = await counter.fetch("https://visit-counter/", { method: "POST", body: visitorId });
      const counts = await countResponse.json();

      const html = await assetResponse.text();
      const stats = `<script>window.__VISIT_STATS__=${JSON.stringify(counts)};</script>`;
      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      headers.delete("etag");
      headers.set("Cache-Control", "no-store");
      if (!existingVisitorId) {
        headers.append("Set-Cookie", `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${url.protocol === "https:" ? "; Secure" : ""}`);
      }
      const publicOrigin = url.hostname === "cutu.suryansh.lol" ? "https://cutu.suryansh.lol" : url.origin;
      return new Response(applyShareMeta(html, url, publicOrigin).replace("</head>", `${stats}</head>`), {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
