import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";
import { renderShareCard } from "./src/share-card.js";
import { applyPageMeta } from "./src/page-meta.js";
import { readMemeUrl } from "./site/memes.js";
import { handleEmailIntake } from "./src/email-intake.js";
import { createLocalEmailStore } from "./src/local-email-store.js";
import { readFile } from "node:fs/promises";
import { adminPageHeaders, createMemoryAdminStore, dashboardPage, handleAdminRequest } from "./src/admin.js";
import { createMemoryDownloadStore, handleDownloadEvent, templateDownloadRows } from "./src/download-events.js";
import { BrandBookingService } from "./src/brand-bookings.js";
import { createLocalBrandStore } from "./src/local-brand-store.js";
import { createLocalBrandPayments } from "./src/local-brand-payments.js";

try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }

const port = Number(process.env.PORT || 4173);
const root = resolve("site");
const saveEmail = createLocalEmailStore(resolve(".local-data", "emails.json"));
const adminStore = createMemoryAdminStore();
const downloadStore = createMemoryDownloadStore();
const testPayments = process.argv.includes("--test-payments") ? createLocalBrandPayments() : null;
const brandBookings = testPayments
  ? new BrandBookingService(testPayments.storage, testPayments.env, { fetcher: testPayments.fetcher })
  : new BrandBookingService(createLocalBrandStore(resolve(".local-data", "brands.json")), process.env);
setInterval(() => brandBookings.sweep().catch(() => {}), 60000).unref();
async function readLocalDashboard(offset) {
  let emails;
  try { emails = JSON.parse(await readFile(resolve(".local-data", "emails.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; emails = []; }
  const downloads = downloadStore.readCounts();
  return { ...dashboardPage(emails, { today: null, total: null }, offset), downloads, templateDownloads: templateDownloadRows(downloads, downloadStore.readTemplates()) };
}
const cardStamps = new Map();
function loadCardStamp(meme) {
  if (!cardStamps.has(meme.id)) cardStamps.set(meme.id, readFileSync(resolve(root, meme.shareImage.slice(1))));
  return cardStamps.get(meme.id);
}
const shareFont = readFileSync(resolve(root, "share-lora.woff2"));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

const server = createServer(async (request, response) => {
  let pathname;
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname.startsWith("/__local-payments/")) {
    if (!testPayments) { response.writeHead(404).end("Not found"); return; }
    if (pathname === "/__local-payments/checkout.js" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      response.end(readFileSync(resolve("src/local-test-checkout.js"), "utf8")); return;
    }
    if (pathname === "/__local-payments/complete") {
      const result = await testPayments.complete(new Request(url, { method: request.method, headers: request.headers, ...(!["GET", "HEAD"].includes(request.method) ? { body: request, duplex: "half" } : {}) }));
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
    }
    response.writeHead(404).end("Not found"); return;
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
      else result = await handleDownloadEvent(apiRequest, downloadStore.recordEvent);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Temporarily unavailable. Try again." }));
    }
    return;
  }
  if (pathname.startsWith("/api/brands/")) {
    try {
      const headers = new Headers(request.headers);
      headers.delete("CF-Connecting-IP");
      const result = await brandBookings.handle(new Request(url, {
        method: request.method, headers,
        ...(!["GET", "HEAD"].includes(request.method) ? { body: request, duplex: "half" } : {})
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch { response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "Bookings are temporarily unavailable." })); }
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
      const { meme, message } = readMemeUrl(url);
      const png = await renderShareCard(message, loadCardStamp(meme), shareFont, Resvg, meme.id);
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
    let html = isAdminPage ? source : applyPageMeta(source, url, url.hostname === "cutu.suryansh.lol" ? "https://cutu.suryansh.lol" : url.origin);
    if (testPayments && !isAdminPage) html = html.replace('<script type="module" src="brands.js"></script>', '<script src="/__local-payments/checkout.js"></script><script type="module" src="brands.js"></script>');
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
  console.log(`cutu is running at http://127.0.0.1:${server.address().port}`);
  if (testPayments) console.log("Local payment simulation enabled. No real charges; brand test data resets on restart.");
});
