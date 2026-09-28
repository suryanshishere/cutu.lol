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
    const url = new URL(request.url);
    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";

    if (isWebSocket) {
      const sessionId = url.searchParams.get("session")?.slice(0, 96);
      if (!sessionId) return new Response("Missing session", { status: 400 });
      return this.connect(sessionId);
    }

    if (request.method === "GET") {
      return Response.json(await this.readCounts(), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  async connect(sessionId) {
    const now = Date.now();
    const sessionKey = `session:${sessionId}`;
    const existing = await this.state.storage.get(sessionKey);

    if (!existing) {
      await this.state.storage.transaction(async (storage) => {
        const duplicate = await storage.get(sessionKey);
        if (duplicate) return;

        const day = indiaDateKey();
        const total = (await storage.get("total")) || 0;
        const today = (await storage.get(`day:${day}`)) || 0;
        await storage.put({
          [sessionKey]: now,
          total: total + 1,
          [`day:${day}`]: today + 1
        });
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ sessionId, connectedAt: now });

    const counts = await this.readCounts();
    this.broadcast(counts);
    this.state.waitUntil(this.cleanupSessions(now));

    return new Response(null, { status: 101, webSocket: client });
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

  broadcast(counts) {
    const message = JSON.stringify(counts);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Cloudflare removes closed sockets from subsequent getWebSockets calls.
      }
    }
  }

  async cleanupSessions(now) {
    if (Math.random() > 0.04) return;
    const sessions = await this.state.storage.list({ prefix: "session:" });
    const cutoff = now - 86_400_000;
    const expired = [...sessions.entries()]
      .filter(([, createdAt]) => createdAt < cutoff)
      .map(([key]) => key);
    if (expired.length) await this.state.storage.delete(expired);
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose() {}

  webSocketError() {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats") {
      const id = env.VISIT_COUNTER.idFromName(SITE_COUNTER_NAME);
      return env.VISIT_COUNTER.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
