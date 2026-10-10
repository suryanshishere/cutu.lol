import { TEXT_FONTS, normalizeAppearance, clamp } from "./text-appearance.js";
import { FRAME_ASPECT_RATIO } from "./memes.js";

const textLayoutCache = new Map();
export function clearTextLayoutCache() { textLayoutCache.clear(); }

export function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const character of Array.from(word)) {
        if (line && context.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Measure at a canonical width so wrapping is identical at every export resolution.
export function layoutText(context, text, width, height, appearance) {
  const style = normalizeAppearance(appearance);
  const font = TEXT_FONTS[style.fontId];
  const canonicalHeight = 1000 / FRAME_ASPECT_RATIO;
  const key = `${style.fontId}:${text}`;
  let base = textLayoutCache.get(key);
  if (!base) {
    const measure = (size) => {
      context.font = `700 ${size}px ${font.family}`;
      const padding = size * 0.08;
      const lines = [];
      const paragraphEnds = [];
      for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
        const wrapped = wrapText(context, paragraph, 520 - padding * 2);
        lines.push(...wrapped);
        paragraphEnds.push(...wrapped.map((_, index) => index === wrapped.length - 1));
      }
      const metrics = lines.map((line) => context.measureText(line));
      const widths = metrics.map((metric) => metric.width);
      const inkPadding = Math.max(padding, ...metrics.flatMap((metric) => [
        metric.actualBoundingBoxLeft || 0, (metric.actualBoundingBoxRight || metric.width) - metric.width
      ]));
      const ascent = Math.max(size * 0.7, ...metrics.map((metric) => metric.actualBoundingBoxAscent || 0));
      const descent = Math.max(size * 0.2, ...metrics.map((metric) => metric.actualBoundingBoxDescent || 0));
      const lineHeight = size * font.lineHeight;
      const inkHeight = ascent + descent + (lines.length - 1) * lineHeight;
      const blockHeight = Math.max(lineHeight * lines.length, inkHeight);
      return {
        lines, widths, paragraphEnds,
        wordWidths: lines.map((line) => line.split(" ").map((word) => context.measureText(word).width)),
        size, padding: inkPadding, lineHeight, width: Math.max(1, ...widths) + inkPadding * 2,
        height: blockHeight, baseline: (blockHeight - inkHeight) / 2 + ascent
      };
    };
    let low = 0.5;
    let high = Math.min(103, canonicalHeight * 0.16);
    base = measure(low);
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = measure((low + high) / 2);
      if (candidate.height <= canonicalHeight * 0.78 && candidate.width <= 520) {
        base = candidate;
        low = candidate.size;
      } else high = candidate.size;
    }
    if (textLayoutCache.size >= 64) textLayoutCache.clear();
    textLayoutCache.set(key, base);
  }
  const effectiveScale = Math.min(style.scale, 900 / base.width, 900 * height / width / base.height);
  const factor = width / 1000 * effectiveScale;
  return {
    ...base, font: font.family, effectiveScale,
    widths: base.widths.map((value) => value * factor),
    wordWidths: base.wordWidths.map((words) => words.map((value) => value * factor)),
    ...Object.fromEntries(["size", "padding", "lineHeight", "width", "height", "baseline"].map((name) => [name, base[name] * factor]))
  };
}

export function placeText(layout, width, height, position = null, side = "right", alignment = "auto") {
  const x = position ? position.x * width - layout.width / 2 : side === "left" ? width * 0.05 : width * 0.95 - layout.width;
  const y = (position ? position.y * height : height / 2) - layout.height / 2;
  return {
    x: clamp(x, width * 0.05, width * 0.95 - layout.width),
    y: clamp(y, height * 0.05, height * 0.95 - layout.height),
    align: alignment === "auto" ? position ? "center" : side : alignment
  };
}

export function textLineX(layout, index, align) {
  const extra = layout.width - layout.padding * 2 - layout.widths[index];
  return layout.padding + extra * (align === "center" ? 0.5 : align === "right" ? 1 : 0);
}

// Distribute whole words only on wrapped lines, as in a normal justified paragraph.
export function textRuns(layout, index, align) {
  const words = layout.lines[index].split(" ");
  if (align !== "justify" || layout.paragraphEnds[index] || words.length < 2) {
    return [{ text: layout.lines[index], x: 0 }];
  }
  const widths = layout.wordWidths[index];
  const gap = (layout.width - layout.padding * 2 - widths.reduce((sum, value) => sum + value, 0)) / (words.length - 1);
  let x = 0;
  return words.map((text, word) => {
    const run = { text, x };
    x += widths[word] + gap;
    return run;
  });
}
