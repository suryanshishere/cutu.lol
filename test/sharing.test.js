import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Resvg } from "@cf-wasm/resvg/node";
import { MEMES, SITE_TITLE, MAX_TEXT_LENGTH, normalizeText, readMemeUrl, createShareUrl, createCardUrl } from "../site/memes.js";
import { applyPageMeta, pageMetadata } from "../src/page-meta.js";
import { shareCardSvg, renderShareCard } from "../src/share-card.js";

const origin = "https://cutu.suryansh.lol";
const source = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

test("legacy links, both stamps, and unknown stamps round-trip through one URL contract", () => {
  for (const stamp of [undefined, "baby-boo", "speed", "unknown", "__proto__", "constructor"]) {
    const input = new URL("/", origin);
    if (stamp) input.searchParams.set("stamp", stamp);
    input.searchParams.set("text", "Hello & goodbye!\nA gift 🎁 for you");
    const value = readMemeUrl(input);
    assert.equal(value.meme.id, stamp === "speed" ? "speed" : "baby-boo");
    assert.deepEqual(readMemeUrl(createShareUrl(origin, stamp, value.text)), value);
    const card = createCardUrl(origin, stamp, value.text);
    assert.equal(card.pathname, "/share-card.png");
    assert.equal(card.searchParams.get("v"), "2");
    assert.equal(readMemeUrl(card).message, value.message);
  }
});

test("text policy preserves line breaks and Unicode and never splits an emoji at the limit", () => {
  assert.equal(normalizeText("  Hi\r\nthere\t🎉\u0000 "), "Hi\nthere 🎉");
  assert.equal(normalizeText("x".repeat(119) + "🎉"), "x".repeat(119));
  assert.equal(normalizeText("🎉".repeat(100)).length, MAX_TEXT_LENGTH);
  assert.equal(normalizeText("x".repeat(500)), "x".repeat(MAX_TEXT_LENGTH));
  for (const stamp of Object.keys(MEMES)) {
    const value = readMemeUrl(new URL(`/?stamp=${stamp}&text=%20%0A%20`, origin));
    assert.equal(value.message, MEMES[stamp].defaultText);
  }
  assert.doesNotMatch(MEMES.speed.defaultText, /wheel|hamster/i);
});

test("homepage is general and share metadata matches each selected meme", () => {
  assert.equal(pageMetadata(new URL(origin)).title, SITE_TITLE);
  for (const stamp of Object.keys(MEMES)) {
    const url = createShareUrl(origin, stamp, "You made my day 🎉");
    const meta = pageMetadata(url);
    const html = applyPageMeta(source, url);
    assert.equal(meta.canonical, `${origin}/`);
    assert.match(meta.title, new RegExp(MEMES[stamp].name));
    assert.equal(meta.description, "You made my day 🎉");
    assert.equal(readMemeUrl(new URL(meta.image)).meme.id, stamp);
    assert.ok(html.includes("<title>cutu</title>"));
    assert.ok(html.includes(`data-stamp="${stamp}" aria-label="${MEMES[stamp].name} Video Preview"`));
    assert.ok(html.includes(`src="${MEMES[stamp].preview[0][0]}"`));
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
    assert.equal(graph[1].name, "cutu Personalized Meme Maker");
    assert.equal(graph[2].name, meta.title);
    assert.equal(graph[2].image, meta.image);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  }
});

test("markup and replacement-like user text stays inert in HTML, JSON-LD, and SVG", () => {
  const text = "</textarea></script><img src=x onerror='alert(1)'> & $& $` $'";
  const html = applyPageMeta(source, createShareUrl(origin, "speed", text));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('</textarea></script>'));
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json)["@graph"][2].description, text.trim());
  const svg = shareCardSvg(text, new Uint8Array([1, 2, 3]), "speed");
  assert.ok(!svg.includes('<img src=x'));
  assert.ok(svg.includes('&lt;'));
});

test("both stamps render valid 1200 by 630 PNGs with different artwork", async () => {
  const font = await readFile(new URL("../site/share-lora.woff2", import.meta.url));
  const cards = [];
  for (const meme of Object.values(MEMES)) {
    const stamp = await readFile(new URL(`../site${meme.shareImage}`, import.meta.url));
    const png = Buffer.from(await renderShareCard("Made for you\nWith love!", stamp, font, Resvg, meme.id));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.ok(png.length > 10000);
    cards.push(png);
    const fallback = shareCardSvg("", stamp, meme.id);
    assert.ok(fallback.includes(meme.defaultText.split(" ")[0]));
  }
  assert.notDeepEqual(cards[0], cards[1]);
});

test("Node serves metadata, HEAD, cards, and validated download events", async (t) => {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL("../", import.meta.url), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { child.kill(); if (child.exitCode === null) await once(child, "exit"); });
  let output = "";
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 10000);
    child.on("error", reject);
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  for (const stamp of Object.keys(MEMES)) {
    const url = createShareUrl(address, stamp, "Hello & welcome!");
    const get = await fetch(url);
    const html = await get.text();
    assert.equal(get.status, 200);
    assert.match(html, new RegExp(`A ${MEMES[stamp].name} message for you`));
    const head = await fetch(url, { method: "HEAD" });
    for (const header of ["content-type", "content-length", "cache-control"]) assert.equal(head.headers.get(header), get.headers.get(header));
    assert.equal(await head.text(), "");
    const card = await fetch(createCardUrl(address, stamp, "Hi"));
    assert.equal(card.headers.get("content-type"), "image/png");
    const png = Buffer.from(await card.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    const cardHead = await fetch(createCardUrl(address, stamp, "Hi"), { method: "HEAD" });
    assert.equal(cardHead.headers.get("content-type"), card.headers.get("content-type"));
    assert.equal(await cardHead.text(), "");
  }
  const endpoint = new URL("/api/download-event", address);
  const methodRejected = await fetch(endpoint);
  assert.equal(methodRejected.status, 405);
  assert.equal(methodRejected.headers.get("Allow"), "POST");
  const event = { format: "video", id: crypto.randomUUID() };
  const post = (origin) => fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(event)
  });
  assert.equal((await post("https://other.example")).status, 403);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await post(address);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true });
  }
});
