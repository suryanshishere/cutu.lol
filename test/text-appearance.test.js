import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, TEXT_FONTS, normalizeAppearance, restoreAppearance, saveAppearance } from "../site/text-appearance.js";
import { layoutText, placeText, placeMemeText, clearTextLayoutCache, textLineX, textRuns } from "../site/text-layout.js";
import { MEMES, createShareUrl, readMemeUrl, previewWidthPercent, exportDimensions } from "../site/memes.js";
import { pageMetadata } from "../src/page-meta.js";

const origin = "https://cutu.suryansh.lol";

test("appearance persists on refresh while new shared links retain their design", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const style = { fontId: "handwritten", scale: 1.3, alignment: "center", position: { x: 0.4, y: 0.6 } };
  const current = new URL("/?text=hello", origin);
  saveAppearance(style, storage, current.href);
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage), style);
  assert.deepEqual(restoreAppearance(new URL(origin), DEFAULT_APPEARANCE, storage), style);
  assert.deepEqual(restoreAppearance(new URL("/?text=other", origin), DEFAULT_APPEARANCE, storage), DEFAULT_APPEARANCE);
  saveAppearance(DEFAULT_APPEARANCE, storage, current.href);
  assert.deepEqual(restoreAppearance(current, style, storage), DEFAULT_APPEARANCE);
});

test("unavailable or malformed storage does not break the editor", () => {
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.doesNotThrow(() => saveAppearance(DEFAULT_APPEARANCE, blocked));
  assert.deepEqual(restoreAppearance(new URL(origin), DEFAULT_APPEARANCE, blocked), DEFAULT_APPEARANCE);
  assert.deepEqual(restoreAppearance(new URL(origin), DEFAULT_APPEARANCE, { getItem: () => "{" }), DEFAULT_APPEARANCE);
});

test("each template retains its own appearance and resetting one leaves the others untouched", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const current = new URL(origin);
  const baby = normalizeAppearance({ position: { x: 0.3, y: 0.4 }, alignment: "left", box: { width: 0.4, height: 0.5 } });
  const speed = normalizeAppearance({ position: { x: 0.7, y: 0.3 }, fontId: "bold", scale: 1.2 });
  saveAppearance(baby, storage, current.href, "baby-boo");
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "speed"), DEFAULT_APPEARANCE);
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "clip"), DEFAULT_APPEARANCE);
  saveAppearance(speed, storage, current.href, "speed");
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "baby-boo"), baby);
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "speed"), speed);
  saveAppearance(DEFAULT_APPEARANCE, storage, current.href, "speed");
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "baby-boo"), baby);
  assert.deepEqual(restoreAppearance(current, speed, storage, "speed"), DEFAULT_APPEARANCE);
  const shared = createShareUrl(origin, "clip", "Hello", { position: { x: 0.5, y: 0.7 } });
  const sharedAppearance = readMemeUrl(shared).appearance;
  assert.deepEqual(restoreAppearance(shared, sharedAppearance, storage, "clip"), sharedAppearance);
});

test("legacy global placement belongs only to the template in its source URL", () => {
  const appearance = normalizeAppearance({ position: { x: 0.6, y: 0.4 } });
  const values = new Map([["cutu.text-appearance.v1", JSON.stringify({ appearance, source: `${origin}/?stamp=speed` })]]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  const current = new URL(origin);
  assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, "speed"), appearance);
  for (const stamp of ["baby-boo", "clip"]) {
    assert.deepEqual(restoreAppearance(current, DEFAULT_APPEARANCE, storage, stamp), DEFAULT_APPEARANCE);
  }
});
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

test("Clip changes preview width without changing height and exports at 4:3", () => {
  for (const containerWidth of [280, 350, 720]) {
    const referenceHeight = containerWidth / MEMES["baby-boo"].frameAspectRatio;
    for (const meme of Object.values(MEMES)) {
      const previewWidth = containerWidth * previewWidthPercent(meme) / 100;
      close(previewWidth / meme.frameAspectRatio, referenceHeight);
    }
  }
  assert.equal(previewWidthPercent(MEMES.clip), 75);
  for (const longEdge of [480, 720, 960]) {
    const dimensions = exportDimensions(MEMES.clip, longEdge);
    assert.deepEqual(dimensions, { width: longEdge, height: longEdge * 3 / 4 });
    for (const id of ["baby-boo", "speed"]) {
      assert.deepEqual(exportDimensions(MEMES[id], longEdge), {
        width: longEdge, height: Math.round(longEdge / (16 / 9) / 2) * 2
      });
    }
  }
});

test("Clip defaults to centered lower text and manual placement scales across exports", () => {
  for (const fontId of Object.keys(TEXT_FONTS)) for (const position of [null, { x: 0.3, y: 0.4 }]) {
    const style = { ...DEFAULT_APPEARANCE, fontId, position };
    let first;
    for (const width of [300, 540, 720, 960, 480]) {
      const height = width * 3 / 4;
      const layout = layoutText(measuringContext(), "Your text\nYour moment", width, height, style);
      const placement = placeMemeText(layout, width, height, style, MEMES.clip, "left");
      assert.equal(placement.align, "center");
      close((placement.x + layout.width / 2) / width, position?.x ?? 0.5);
      close((placement.y + layout.height / 2) / height, Math.min(position?.y ?? 0.85, 0.95 - layout.height / height / 2));
      assert.ok(placement.y + layout.height <= height * 0.95 + 0.00001);
      const normalized = [placement.x / width, placement.y / height, layout.size / width];
      if (first) normalized.forEach((value, index) => close(value, first[index]));
      else first = normalized;
      assert.deepEqual(placeMemeText(layout, width, height, { ...style, alignment: "left" }, MEMES.clip).align, "left");
    }
  }
});

test("automatic captions follow each video's composition across preview and export sizes", () => {
  for (const width of [300, 480, 720, 960]) {
    for (const meme of Object.values(MEMES)) {
      const height = width / meme.frameAspectRatio;
      const layout = layoutText(measuringContext(), meme.defaultText, width, height, DEFAULT_APPEARANCE);
      for (const side of ["left", "right"]) {
        const automatic = placeMemeText(layout, width, height, DEFAULT_APPEARANCE, meme, side);
        assert.equal(automatic.align, meme.id === "speed" ? "left" : "center");
        if (meme.defaultTextPosition) {
          const expected = placeText(layout, width, height, meme.defaultTextPosition, side, meme.defaultTextAlignment);
          assert.deepEqual(automatic, expected);
        } else {
          close(automatic.x, side === "left" ? width * 0.05 : width * 0.95 - layout.width);
        }
        const explicit = placeMemeText(layout, width, height, { ...DEFAULT_APPEARANCE, alignment: "right" }, meme, side);
        assert.equal(explicit.align, "right");
        const manual = { ...DEFAULT_APPEARANCE, position: { x: 0.5, y: 0.5 } };
        assert.deepEqual(placeMemeText(layout, width, height, manual, meme, side), placeText(layout, width, height, manual.position));
      }
    }
  }
});

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

test("appearance survives share links and server metadata for all templates", () => {
  for (const stamp of Object.keys(MEMES)) for (const fontId of Object.keys(TEXT_FONTS)) {
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

test("custom box dimensions survive links and storage and malformed dimensions stay bounded", () => {
  for (const box of [{ width: 0.7, height: 0.4 }, { width: null, height: 0.3 }, { width: 0.6, height: null }]) {
    const appearance = { ...DEFAULT_APPEARANCE, box };
    for (const stamp of Object.keys(MEMES)) {
      const url = createShareUrl(origin, stamp, "Hello", appearance);
      assert.deepEqual(readMemeUrl(url).appearance, appearance);
      assert.equal(pageMetadata(url).shareUrl, url.href);
    }
    let saved;
    const storage = { setItem: (_, value) => { saved = value; }, getItem: () => saved };
    saveAppearance(appearance, storage, origin);
    assert.deepEqual(restoreAppearance(new URL(origin), DEFAULT_APPEARANCE, storage), appearance);
    assert.deepEqual(restoreAppearance(new URL("/?boxWidth=0.2", origin), DEFAULT_APPEARANCE, storage), DEFAULT_APPEARANCE);
  }
  assert.equal(normalizeAppearance({ box: { width: "Infinity", height: false } }).box, undefined);
  assert.equal(normalizeAppearance({ box: { width: "", height: "NaN" } }).box, undefined);
  assert.deepEqual(normalizeAppearance({ box: { width: 5, height: -1 } }).box, { width: 0.9, height: 0.05 });
});

test("box width controls wrapping, height centers text, and content fits every template and export size", () => {
  const message = "Every little moment is a chance to make somebody smile.";
  const wide = layoutText(measuringContext(), message, 720, 405, { box: { width: 0.8, height: 0.8 } });
  const narrow = layoutText(measuringContext(), message, 720, 405, { box: { width: 0.3, height: 0.8 } });
  assert.ok(narrow.lines.length > wide.lines.length);
  for (const meme of Object.values(MEMES)) for (const fontId of Object.keys(TEXT_FONTS)) {
    for (const box of [{ width: 0.8, height: 0.6 }, { width: 0.05, height: 0.05 }, { width: null, height: 0.3 }, { width: 0.4, height: null }]) {
      const style = { fontId, scale: 2, position: { x: 0.95, y: 0.05 }, box };
      let first;
      for (const width of [288, 480, 720, 960]) {
        const height = width / meme.frameAspectRatio;
        const layout = layoutText(measuringContext(), message, width, height, style);
        if (box.width !== null) close(layout.width, width * box.width);
        if (box.height !== null) close(layout.height, height * box.height);
        const inkTop = layout.baseline - layout.size * 0.8;
        const inkBottom = layout.baseline + (layout.lines.length - 1) * layout.lineHeight + layout.size * 0.22;
        assert.ok(inkTop >= -0.00001);
        assert.ok(inkBottom <= layout.height + 0.00001);
        assert.ok(Math.max(...layout.widths) + layout.padding * 2 <= layout.width + 0.00001);
        close(inkTop, layout.height - inkBottom);
        const position = placeMemeText(layout, width, height, style, meme);
        assert.ok(position.x >= width * 0.05 - 0.00001);
        assert.ok(position.x + layout.width <= width * 0.95 + 0.00001);
        assert.ok(position.y >= height * 0.05 - 0.00001);
        assert.ok(position.y + layout.height <= height * 0.95 + 0.00001);
        if (first) {
          assert.deepEqual(layout.lines, first.lines);
          close(layout.size / width, first.size / first.frameWidth);
        } else first = { ...layout, frameWidth: width };
      }
    }
  }
});

test("small custom boxes fit long content and reuse fitting during successive export frames", () => {
  for (const fontId of Object.keys(TEXT_FONTS)) for (const message of ["W".repeat(120), "🎉".repeat(60), "a\n".repeat(60)]) {
    clearTextLayoutCache();
    const context = measuringContext();
    const style = { fontId, scale: 2, box: { width: 0.05, height: 0.05 } };
    const layout = layoutText(context, message, 720, 405, style);
    assert.ok(Math.max(...layout.widths) + layout.padding * 2 <= layout.width + 0.00001);
    assert.ok(layout.baseline + (layout.lines.length - 1) * layout.lineHeight + layout.size * 0.22 <= layout.height + 0.00001);
    context.measureText = () => { throw new Error("Fitting should be cached for the next frame"); };
    assert.deepEqual(layoutText(context, message, 720, 405, style), layout);
  }
});
