import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";
import { applyShareMeta, renderShareCard, shareText } from "./src/share-card.js";

const port = Number(process.env.PORT || 4173);
const root = resolve("site");
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
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);

  if ((!filePath.startsWith(root + sep) && filePath !== root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stat = statSync(filePath);
  const type = contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  if (type.startsWith("text/html")) {
    const html = applyShareMeta(readFileSync(filePath, "utf8"), url);
    response.writeHead(200, { "Content-Type": type, "Content-Length": Buffer.byteLength(html), "Cache-Control": "no-cache" });
    response.end(html);
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
