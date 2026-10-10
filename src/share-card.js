import { normalizeText, getMeme } from "../site/memes.js";
import { escapeMarkup } from "./page-meta.js";

function lineWidth(line) {
  return [...line].reduce((width, char) => {
    if (/[ilI.,'!|:; ]/.test(char)) return width + 0.31;
    if (/[MW@#%&]/.test(char)) return width + 0.9;
    if (/[A-Z0-9]/.test(char)) return width + 0.68;
    return width + (char.codePointAt(0) > 0x2e80 ? 1 : 0.55);
  }, 0);
}

function wrapMessage(message, size, maxWidth = 350) {
  const maxUnits = maxWidth / size;
  const lines = [];
  for (const paragraph of message.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (lineWidth(candidate) <= maxUnits) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (line && lineWidth(line + char) > maxUnits) { lines.push(line); line = ""; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function layoutMessage(message) {
  // Keep every message beside the stamp so even a short line stays visible.
  for (let size = 52; size >= 8; size -= 2) {
    const lines = wrapMessage(message, size);
    if (Math.ceil(lines.length / 2) * size * 1.18 <= 350) return { lines, size };
  }
  return { lines: wrapMessage(message, 8), size: 8 };
}

function base64(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(result);
}

export function shareCardSvg(value, stampBytes, stamp = "baby-boo") {
  const message = normalizeText(value) || getMeme(stamp).defaultText;
  const { lines, size } = layoutMessage(message);
  const lineHeight = size * 1.18;
  const stampHeight = 350;
  const stampY = (630 - stampHeight) / 2;
  const rows = Math.ceil(lines.length / 2);
  const firstBaseline = 315 + size * 0.3 - ((rows - 1) * lineHeight) / 2;
  const messageLines = lines.map((line, index) => {
    const row = Math.floor(index / 2);
    const x = index % 2 === 0 ? 440 : 760;
    const anchor = index % 2 === 0 ? "end" : "start";
    return `<text x="${x}" y="${Math.round(firstBaseline + row * lineHeight)}" text-anchor="${anchor}" font-family="Lora" font-size="${size}" font-weight="700" fill="#24202d">${escapeMarkup(line)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#fbf8f0"/>
    <rect x="22" y="22" width="1156" height="586" rx="22" fill="none" stroke="#25212b" stroke-width="3"/>
    ${messageLines}
    <image x="460" y="${Math.round(stampY)}" width="280" height="${stampHeight}" transform="rotate(-7 600 ${Math.round(stampY + stampHeight / 2)})" xlink:href="data:image/png;base64,${base64(stampBytes)}"/>
  </svg>`;
}

export async function renderShareCard(value, stampBytes, fontBytes, Resvg, stamp = "baby-boo") {
  const renderer = await Resvg.async(shareCardSvg(value, stampBytes, stamp), {
    font: { fontBuffers: [fontBytes], loadSystemFonts: false, defaultFontFamily: "Lora" }
  });
  return renderer.render().asPng();
}
