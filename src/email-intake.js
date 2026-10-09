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
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply({ error: "Send a JSON email address." }, 415);
  }
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return reply({ error: "Request is too large." }, 413);

  let payload;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Enter a valid email address." }, 400);
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) return reply({ error: "Request is too large." }, 413);
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return reply({ error: "Enter a valid email address." }, 400);
  }

  const email = normalizeEmail(payload?.email);
  if (!email) return reply({ error: "Enter a valid email address, like you@example.com." }, 400);
  try {
    await saveEmail(email);
    return reply({ ok: true });
  } catch {
    return reply({ error: "Couldn’t save your email. Please try again." }, 503);
  }
}

export class EmailIntake {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    return handleEmailIntake(request, (email) => this.state.storage.transaction(async (storage) => {
      const key = `email:${email}`;
      if (await storage.get(key) === undefined) {
        await storage.put(key, { email, createdAt: new Date().toISOString() });
      }
    }));
  }
}
