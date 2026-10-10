const textLayoutCache = new Map();

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

export function layoutText(context, text, width, height) {
  const key = `${width}:${height}:${text}`;
  if (textLayoutCache.has(key)) return textLayoutCache.get(key);

  const maxWidth = width * 0.52;
  const maxHeight = Math.min(height * 0.78, height - 8);
  const initialSize = Math.min(width * 0.103, height * 0.16);
  let low = 0.5;
  let high = initialSize;
  let best = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const size = (low + high) / 2;
    context.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    const lines = wrapText(context, text, maxWidth);
    const widths = lines.map((line) => context.measureText(line).width);
    const layout = { lines, widths, size, lineHeight: size * 0.94, width: Math.max(0, ...widths) };
    if (layout.lineHeight * lines.length <= maxHeight && layout.width <= maxWidth) {
      best = layout;
      low = size;
    } else {
      high = size;
    }
  }

  if (!best) {
    context.font = `700 0.5px Georgia, "Times New Roman", serif`;
    const lines = wrapText(context, text, maxWidth);
    const widths = lines.map((line) => context.measureText(line).width);
    best = { lines, widths, size: 0.5, lineHeight: 0.47, width: Math.max(0, ...widths) };
  }
  if (textLayoutCache.size > 12) textLayoutCache.clear();
  textLayoutCache.set(key, best);
  return best;
}
