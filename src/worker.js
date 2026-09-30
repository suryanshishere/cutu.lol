const SITE_COUNTER_NAME = "hamster-sitewide";

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
      return Response.json(await this.recordVisit(), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  async recordVisit() {
    const day = indiaDateKey();
    await this.state.storage.transaction(async (storage) => {
      const total = (await storage.get("total")) || 0;
      const today = (await storage.get(`day:${day}`)) || 0;
      await storage.put({ total: total + 1, [`day:${day}`]: today + 1 });
    });
    return this.readCounts();
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

    const isPageLoad = request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html");
    if (isPageLoad) {
      const id = env.VISIT_COUNTER.idFromName(SITE_COUNTER_NAME);
      const counter = env.VISIT_COUNTER.get(id);
      const [assetResponse, countResponse] = await Promise.all([
        env.ASSETS.fetch(request),
        counter.fetch("https://visit-counter/", { method: "POST" })
      ]);
      const counts = await countResponse.json();
      if (!assetResponse.ok || !assetResponse.headers.get("content-type")?.includes("text/html")) {
        return assetResponse;
      }

      const html = await assetResponse.text();
      const stats = `<script>window.__VISIT_STATS__=${JSON.stringify(counts)};</script>`;
      const headers = new Headers(assetResponse.headers);
      headers.delete("content-length");
      headers.delete("etag");
      headers.set("Cache-Control", "no-store");
      return new Response(html.replace("</head>", `${stats}</head>`), {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
