import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, TEXT_FONTS, normalizeAppearance } from "../site/text-appearance.js";
import { layoutText, placeText, clearTextLayoutCache, textLineX, textRuns } from "../site/text-layout.js";
import { createShareUrl, readMemeUrl } from "../site/memes.js";
import { pageMetadata } from "../src/page-meta.js";

const origin = "https://cutu.suryansh.lol";
// Predictable metrics let geometry tests run without a browser or native canvas.
function measuringContext() {
  return {
    font: "",
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      const familyFactor = this.font.includes("Mono") ? 0.6 : this.font.includes("Caveat") ? 0.4 : 0.5;
      return { width: [...text].length * size * familyFactor, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.22 };
    }
  };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("appearance is optional and defaults are omitted from legacy URLs", () => {
  assert.deepEqual(readMemeUrl(new URL(origin)).appearance, DEFAULT_APPEARANCE);
  const link = createShareUrl(origin, "baby-boo", "Hello", DEFAULT_APPEARANCE);
  assert.equal(link.search, "?text=Hello");
  assert.deepEqual(normalizeAppearance(null), DEFAULT_APPEARANCE);
  assert.equal(DEFAULT_APPEARANCE.scale, 0.9);
  const explicitSize = createShareUrl(origin, "baby-boo", "Hello", { scale: 1 });
  assert.equal(explicitSize.searchParams.get("scale"), "1");
  assert.equal(readMemeUrl(explicitSize).appearance.scale, 1);
});

test("appearance survives share links and server metadata for both templates", () => {
  for (const stamp of ["baby-boo", "speed"]) for (const fontId of Object.keys(TEXT_FONTS)) {
    const appearance = { fontId, scale: 1.35, alignment: "justify", position: { x: 0.37, y: 0.64 } };
    const link = createShareUrl(origin, stamp, "Hello\n🎉", appearance);
    assert.deepEqual(readMemeUrl(link).appearance, appearance);
    assert.equal(pageMetadata(link).shareUrl, link.href);
    assert.deepEqual(JSON.parse(JSON.stringify(readMemeUrl(new URL(pageMetadata(link).structuredData["@graph"][2].url)).appearance)), appearance);
    assert.ok(!new URL(pageMetadata(link).image).searchParams.has("font"));
  }
});

test("invalid appearance values cannot introduce CSS or non-finite geometry", () => {
  for (const font of ["__proto__", "constructor", 'serif; color:red', "missing"]) {
    const link = new URL(`/?font=${encodeURIComponent(font)}&scale=Infinity&x=NaN&y=0.4`, origin);
    assert.deepEqual(readMemeUrl(link).appearance, DEFAULT_APPEARANCE);
  }
  for (const query of ["x=0.3", "y=0.5", "x=&y=0.5", "scale=oops", "scale="]) {
    assert.deepEqual(readMemeUrl(new URL(`/?${query}`, origin)).appearance, DEFAULT_APPEARANCE);
  }
  assert.deepEqual(normalizeAppearance({ scale: 500, position: { x: -10, y: 10 } }), { fontId: "classic", scale: 2, alignment: "auto", position: { x: 0.05, y: 0.95 } });
  assert.equal(normalizeAppearance({ scale: -5 }).scale, 0.5);
});

test("explicit alignment survives placement changes and justification leaves paragraph endings natural", () => {
  const message = "Every little moment is a chance to make somebody smile.\nWith love";
  for (const alignment of ["left", "center", "right", "justify"]) {
    const style = { ...DEFAULT_APPEARANCE, alignment };
    const layout = layoutText(measuringContext(), message, 720, 405, style);
    assert.equal(placeText(layout, 720, 405, null, "left", alignment).align, alignment);
    assert.equal(placeText(layout, 720, 405, { x: 0.5, y: 0.5 }, "right", alignment).align, alignment);
    assert.equal(readMemeUrl(createShareUrl(origin, "speed", message, style)).appearance.alignment, alignment);
    if (alignment === "justify") {
      const first = textRuns(layout, 0, alignment);
      assert.ok(first.length > 1);
      close(first.at(-1).x + layout.wordWidths[0].at(-1), layout.width - layout.padding * 2);
      assert.deepEqual(textRuns(layout, layout.lines.length - 1, alignment), [{ text: "With love", x: 0 }]);
    }
  }
  assert.equal(normalizeAppearance({ alignment: "invalid" }).alignment, "auto");
});

test("wrapping, font size, and fixed placement scale equally for preview, video, and GIF", () => {
  clearTextLayoutCache();
  for (const fontId of Object.keys(TEXT_FONTS)) {
    const style = { fontId, scale: 1.4, position: { x: 0.63, y: 0.32 } };
    const first = layoutText(measuringContext(), "You made\nmy day 🎉", 720, 405, style);
    const placed = placeText(first, 720, 405, style.position);
    for (const width of [288, 480, 960]) {
      const height = width * 9 / 16;
      const other = layoutText(measuringContext(), "You made\nmy day 🎉", width, height, style);
      const position = placeText(other, width, height, style.position);
      assert.deepEqual(first.lines, other.lines);
      close(other.size / width, first.size / 720);
      close(other.width / width, first.width / 720);
      close(position.x / width, placed.x / 720);
      close(position.y / height, placed.y / 405);
      close(other.baseline / width, first.baseline / 720);
    }
  }
});

test("long text, explicit blank lines, and all fonts remain within frame margins at maximum size", () => {
  for (const fontId of Object.keys(TEXT_FONTS)) for (const text of ["Hello!", "W".repeat(120), "a\n\nb", "🎉".repeat(60), "a\n".repeat(60)]) {
    const context = measuringContext();
    const layout = layoutText(context, text, 320, 180, { fontId, scale: 2 });
    assert.ok(layout.width <= 320 * 0.9 + 0.0001);
    assert.ok(layout.height <= 180 * 0.9 + 0.0001);
    assert.ok(layout.effectiveScale >= 0.5 && layout.effectiveScale <= 2);
    for (const center of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const pos = placeText(layout, 320, 180, center);
      assert.ok(pos.x >= 16 - 0.0001 && pos.y >= 9 - 0.0001);
      assert.ok(pos.x + layout.width <= 304 + 0.0001);
      assert.ok(pos.y + layout.height <= 171 + 0.0001);
    }
    if (text === "a\n\nb") assert.deepEqual(layout.lines, ["a", "", "b"]);
  }
});

test("auto placement preserves side alignment and manual placement centers individual lines", () => {
  const layout = layoutText(measuringContext(), "Hello world\nHi", 720, 405);
  const right = placeText(layout, 720, 405);
  const left = placeText(layout, 720, 405, null, "left");
  close(right.x + layout.width, 720 * 0.95);
  close(left.x, 720 * 0.05);
  const manual = placeText(layout, 720, 405, { x: 0.5, y: 0.5 });
  assert.equal(manual.align, "center");
  close(manual.x + layout.width / 2, 360);
  close(manual.y + layout.height / 2, 202.5);
  close(textLineX(layout, 1, "center") + layout.widths[1] / 2, layout.width / 2);
});
