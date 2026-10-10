export const TEXT_FONTS = Object.freeze({
  classic: { label: "Classic", family: 'Georgia, "Times New Roman", serif', lineHeight: 0.94 },
  bold: { label: "Bold sans", family: '"Cutu Nunito Sans", sans-serif', lineHeight: 1.05 },
  handwritten: { label: "Handwritten", family: '"Cutu Caveat", cursive', lineHeight: 1.05 },
  typewriter: { label: "Typewriter", family: '"Cutu Roboto Mono", monospace', lineHeight: 1.15 }
});

export const TEXT_ALIGNMENTS = Object.freeze(["auto", "left", "center", "right", "justify"]);
export const DEFAULT_APPEARANCE = Object.freeze({ fontId: "classic", scale: 0.9, alignment: "auto", position: null });
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function finiteNumber(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim()) || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAppearance(value = {}) {
  const fontId = Object.hasOwn(TEXT_FONTS, value?.fontId) ? value.fontId : "classic";
  const scale = finiteNumber(value?.scale);
  const x = finiteNumber(value?.position?.x);
  const y = finiteNumber(value?.position?.y);
  return {
    fontId, scale: scale === null ? DEFAULT_APPEARANCE.scale : clamp(scale, 0.5, 2),
    alignment: TEXT_ALIGNMENTS.includes(value?.alignment) ? value.alignment : "auto",
    position: x === null || y === null ? null : { x: clamp(x, 0.05, 0.95), y: clamp(y, 0.05, 0.95) }
  };
}

const fontLoads = new Map();
export async function loadTextFont(fontId) {
  if (fontId === "classic" || typeof document === "undefined") return;
  if (!fontLoads.has(fontId)) {
    const family = TEXT_FONTS[fontId]?.family.split(",")[0];
    if (!family) throw new Error("Unknown text font");
    const promise = document.fonts.load(`700 32px ${family}`).then((fonts) => {
      if (!fonts.length) throw new Error("Font could not be loaded");
    }).catch((error) => { fontLoads.delete(fontId); throw error; });
    fontLoads.set(fontId, promise);
  }
  await fontLoads.get(fontId);
}
