import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";
import { applyShareMeta, renderShareCard, shareText } from "./src/share-card.js";
import { handleEmailIntake } from "./src/email-intake.js";
import { createLocalEmailStore } from "./src/local-email-store.js";
import { readFile } from "node:fs/promises";
import { adminPageHeaders, adminResponse, createMemoryAdminStore, dashboardPage, handleAdminRequest, readAdminBody } from "./src/admin.js";

try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }

const port = Number(process.env.PORT || 4173);
const root = resolve("site");
const saveEmail = createLocalEmailStore(resolve(".local-data", "emails.json"));
const adminStore = createMemoryAdminStore();
const localDownloads = { video: 0, gif: 0 };
const localDownloadEvents = new Map();
async function readLocalDashboard(offset) {
  let emails;
  try { emails = JSON.parse(await readFile(resolve(".local-data", "emails.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; emails = []; }
  return { ...dashboardPage(emails, { today: null, total: null }, offset), downloads: localDownloads };
}
const shareStamp = readFileSync(resolve(root, "share-stamp.png"));
const shareFont = readFileSync(resolve(root, "share-lora.woff2"));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

createServer(async (request, response) => {
  let pathname;
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname.startsWith("/api/admin/") || pathname === "/api/download-event") {
    try {
      const headers = new Headers(request.headers);
      headers.delete("CF-Connecting-IP");
      const apiRequest = new Request(url, {
        method: request.method, headers,
        ...(!["GET", "HEAD"].includes(request.method) ? { body: request, duplex: "half" } : {})
      });
      let result;
      if (pathname.startsWith("/api/admin/")) result = await handleAdminRequest(apiRequest, process.env, adminStore, readLocalDashboard);
      else if (request.method !== "POST") result = adminResponse({ error: "Method not allowed." }, 405);
      else if (headers.get("Origin") !== url.origin) result = adminResponse({ error: "Invalid origin." }, 403);
      else {
        const parsed = await readAdminBody(apiRequest);
        if (parsed.error) result = parsed.error;
        else {
          const { format, id } = parsed.value;
          if (!["video", "gif"].includes(format) || typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) result = adminResponse({ error: "Invalid download event." }, 400);
          else {
            for (const [key, time] of localDownloadEvents) if (time < Date.now() - 86400000) localDownloadEvents.delete(key);
            if (!localDownloadEvents.has(id)) { localDownloads[format] += 1; localDownloadEvents.set(id, Date.now()); }
            result = adminResponse({ ok: true });
          }
        }
      }
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Temporarily unavailable. Try again." }));
    }
    return;
  }
  if (pathname === "/api/email-intake") {
    try {
      const apiRequest = new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(!["GET", "HEAD"].includes(request.method) ? { body: request, duplex: "half" } : {})
      });
      const result = await handleEmailIntake(apiRequest, saveEmail);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Couldn’t save your email. Please try again." }));
    }
    return;
  }
  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/share-card.png") {
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" }).end();
      return;
    }
    try {
      const png = await renderShareCard(shareText(url.searchParams.get("text")), shareStamp, shareFont, Resvg);
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
      response.end(png);
    } catch (error) {
      console.error("Share card render failed", error);
      response.writeHead(500).end("Share card render failed");
    }
    return;
  }
  const isAdminPage = ["/admin", "/admin/", "/admin.html"].includes(pathname);
  if (isAdminPage && !["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end("Method not allowed"); return; }
  const relativePath = isAdminPage ? "admin.html" : pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);

  if ((!filePath.startsWith(root + sep) && filePath !== root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stat = statSync(filePath);
  const type = contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  if (type.startsWith("text/html")) {
    const source = readFileSync(filePath, "utf8");
    const html = isAdminPage ? source : applyShareMeta(source, url);
    response.writeHead(200, { "Content-Type": type, "Content-Length": Buffer.byteLength(html), "Cache-Control": "no-cache", ...(isAdminPage ? adminPageHeaders() : {}) });
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }
  const range = request.headers.range;

  if (range && (type === "video/webm" || type === "video/mp4")) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : NaN;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stat.size || end < start || end >= stat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
      return;
    }
    response.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache"
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": type.startsWith("video/") ? "public, max-age=3600" : "no-cache"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Hamster Type is running at http://127.0.0.1:${port}`);
});
