const DEFAULT_TEXT = "Small steps. Big wheel energy.";
const MAX_TEXT_LENGTH = 120;

export function shareText(value) {
  const text = (value || "").slice(0, 1000).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= MAX_TEXT_LENGTH) return text;
  const prefix = text.slice(0, MAX_TEXT_LENGTH - 1);
  const lastSpace = prefix.lastIndexOf(" ");
  return `${(lastSpace > 95 ? prefix.slice(0, lastSpace) : prefix).trimEnd()}…`;
}

function escapeMarkup(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function replaceMeta(html, kind, key, value) {
  const pattern = new RegExp(`<meta ${kind}="${key}" content="[^"]*" \\/>`);
  return html.replace(pattern, `<meta ${kind}="${key}" content="${escapeMarkup(value)}" />`);
}

export function applyShareMeta(html, pageUrl, publicOrigin = pageUrl.origin) {
  const text = shareText(pageUrl.searchParams.get("text"));
  const root = `${publicOrigin}/`;
  const cardUrl = new URL("share-card.png", root);
  if (text) cardUrl.searchParams.set("text", text);
  const shareUrl = new URL(root);
  if (text) shareUrl.searchParams.set("text", text);
  const title = text ? "A Baby Boo message for you | cutu" : "Baby Boo Hamster Meme Maker | cutu";
  const description = text || "Add your text to Baby Boo, preview the animated hamster meme, then download or share it for free.";
  const values = [
    ["name", "description", description],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", shareUrl.href],
    ["property", "og:image", cardUrl.href],
    ["property", "og:image:alt", text ? `Baby Boo card: ${text}` : "Baby Boo hamster meme card"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", cardUrl.href],
    ["name", "twitter:image:alt", text ? `Baby Boo card: ${text}` : "Baby Boo hamster meme card"]
  ];
  return values.reduce((result, [kind, key, value]) => replaceMeta(result, kind, key, value), html);
}

function lineWidth(line) {
  return [...line].reduce((width, char) => {
    if (/[ilI.,'!|:; ]/.test(char)) return width + 0.31;
    if (/[MW@#%&]/.test(char)) return width + 0.9;
    if (/[A-Z0-9]/.test(char)) return width + 0.68;
    return width + (char.codePointAt(0) > 0x2e80 ? 1 : 0.55);
  }, 0);
}

function wrapMessage(message, size, maxWidth = 1000) {
  const maxUnits = maxWidth / size;
  const lines = [];
  let line = "";
  for (const word of message.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (lineWidth(candidate) <= maxUnits) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (line && lineWidth(line + char) > maxUnits) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function layoutMessage(message) {
  if (wrapMessage(message, 58).length > 1) {
    for (const size of [52, 48, 44, 40, 36, 32]) {
      const segments = wrapMessage(message, size, 350);
      const rows = Math.ceil(segments.length / 2);
      if (rows * size * 1.18 <= 300) return { lines: segments, size, aroundStamp: true };
    }
    return { lines: wrapMessage(message, 32, 350), size: 32, aroundStamp: true };
  }
  for (const size of [58, 54, 50, 46, 42, 38, 34]) {
    const lines = wrapMessage(message, size);
    if (lines.length * size * 1.18 <= 205) return { lines, size, aroundStamp: false };
  }
  return { lines: wrapMessage(message, 34), size: 34, aroundStamp: false };
}

function base64(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(result);
}

export function shareCardSvg(value, stampBytes) {
  const message = shareText(value) || DEFAULT_TEXT;
  const { lines, size, aroundStamp } = layoutMessage(message);
  const lineHeight = size * 1.18;
  const stampHeight = 350;
  const stampY = (630 - stampHeight) / 2;
  const rows = aroundStamp ? Math.ceil(lines.length / 2) : lines.length;
  const firstBaseline = 315 + size * 0.3 - ((rows - 1) * lineHeight) / 2;
  const messageLines = lines.map((line, index) => {
    const row = aroundStamp ? Math.floor(index / 2) : index;
    const x = aroundStamp ? (index % 2 === 0 ? 440 : 760) : 600;
    const anchor = aroundStamp ? (index % 2 === 0 ? "end" : "start") : "middle";
    return `<text x="${x}" y="${Math.round(firstBaseline + row * lineHeight)}" text-anchor="${anchor}" font-family="Lora" font-size="${size}" font-weight="700" fill="#24202d">${escapeMarkup(line)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#fbf8f0"/>
    <rect x="22" y="22" width="1156" height="586" rx="22" fill="none" stroke="#25212b" stroke-width="3"/>
    ${messageLines}
    <image x="460" y="${Math.round(stampY)}" width="280" height="${stampHeight}" transform="rotate(-7 600 ${Math.round(stampY + stampHeight / 2)})" xlink:href="data:image/png;base64,${base64(stampBytes)}"/>
  </svg>`;
}

export async function renderShareCard(value, stampBytes, fontBytes, Resvg) {
  const renderer = await Resvg.async(shareCardSvg(value, stampBytes), {
    font: { fontBuffers: [fontBytes], loadSystemFonts: false, defaultFontFamily: "Lora" }
  });
  return renderer.render().asPng();
}
