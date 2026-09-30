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

function wrapMessage(message, size) {
  const maxUnits = 535 / size;
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
  for (const size of [58, 54, 50, 46, 42, 38, 34]) {
    const lines = wrapMessage(message, size);
    if (lines.length * size * 1.18 <= 325) return { lines, size };
  }
  return { lines: wrapMessage(message, 34).slice(0, 8), size: 34 };
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
  const { lines, size } = layoutMessage(message);
  const lineHeight = size * 1.18;
  const firstBaseline = 320 - ((lines.length - 1) * lineHeight) / 2;
  const messageLines = lines.map((line, index) => `<text x="530" y="${Math.round(firstBaseline + index * lineHeight)}" font-family="Lora" font-size="${size}" font-weight="700" fill="#24202d">${escapeMarkup(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#fbf8f0"/>
    <rect x="22" y="22" width="1156" height="586" rx="22" fill="none" stroke="#25212b" stroke-width="3"/>
    <rect x="42" y="42" width="432" height="546" rx="13" fill="#f5d779"/>
    <circle cx="452" cy="94" r="34" fill="#e4b73e" opacity=".45"/>
    <circle cx="73" cy="538" r="50" fill="#e4b73e" opacity=".45"/>
    <image x="58" y="50" width="400" height="500" xlink:href="data:image/png;base64,${base64(stampBytes)}"/>
    <text x="530" y="112" font-family="Lora" font-size="22" font-weight="700" letter-spacing="3" fill="#746c61">A NOTE FROM BABY BOO</text>
    <path d="M530 138h608" stroke="#d8cbb5" stroke-width="2"/>
    ${messageLines}
    <path d="M530 518h608" stroke="#d8cbb5" stroke-width="2"/>
    <circle cx="543" cy="553" r="7" fill="#e0af2e"/>
    <text x="562" y="561" font-family="Lora" font-size="23" font-weight="700" fill="#25212b">made with cutu.lol</text>
  </svg>`;
}

export async function renderShareCard(value, stampBytes, fontBytes, Resvg) {
  const renderer = await Resvg.async(shareCardSvg(value, stampBytes), {
    font: { fontBuffers: [fontBytes], loadSystemFonts: false, defaultFontFamily: "Lora" }
  });
  return renderer.render().asPng();
}
