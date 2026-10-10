import { test } from "node:test";
import assert from "node:assert/strict";
import { createTextEditor } from "../site/text-editor.js";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "../site/text-appearance.js";
import { placeText } from "../site/text-layout.js";

class Element extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.classes = new Set();
    this.captured = new Set();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); }
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  focus() {}
  blur() {}
}

function setup(t) {
  const previous = Object.fromEntries(["document", "window", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const elements = Object.fromEntries(["text-overlay", "text-appearance", "text-font", "text-size", "text-size-value", "appearance-status", "text-reset", "text-motion", "text-motion-option"].map((id) => [id, new Element()]));
  const alignments = ["left", "center", "right", "justify"].map((alignment) => {
    const element = new Element();
    element.dataset.align = alignment;
    return element;
  });
  elements["text-appearance"].querySelectorAll = () => alignments;
  const stage = new Element();
  stage.clientWidth = 720;
  stage.clientHeight = 405;
  stage.clientLeft = stage.clientTop = 1;
  stage.getBoundingClientRect = () => ({ left: 10, top: 20 });
  const layout = { width: 240, height: 90, effectiveScale: 1 };
  let appearance = normalizeAppearance();
  let rect = { left: 455, top: 178.5, width: 240, height: 90 };
  let busy = false;
  let paused = false;
  let starts = 0;
  let stops = 0;
  let changes = 0;
  let stamp = { hasTextMotion: true };
  let frameId = 0;
  const frames = new Map();
  globalThis.document = { querySelector: (selector) => elements[selector.slice(1)] };
  globalThis.window = new EventTarget();
  globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const editor = createTextEditor({
    stage, previewText: { getBoundingClientRect: () => rect },
    getStamp: () => stamp, getAppearance: () => appearance, isRendering: () => busy,
    beginGesture: () => {
      starts += 1;
      const wasPaused = paused;
      paused = true;
      return () => { stops += 1; paused = wasPaused; };
    },
    onChange: (value) => {
      changes += 1;
      appearance = normalizeAppearance(value);
      const position = placeText(layout, 720, 405, appearance.position, "right", appearance.alignment);
      rect = { left: 11 + position.x, top: 21 + position.y, width: layout.width, height: layout.height };
      editor.sync(layout, position, false);
    }
  });
  editor.sync(layout, placeText(layout, 720, 405), false);
  const emit = (id, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 575, clientY: 223.5 }, properties);
    elements[id].dispatchEvent(event);
    return event;
  };
  return {
    editor, elements, emit, alignments,
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    setBusy(value) { busy = value; editor.setBusy(value); },
    setTemplate(value) { stamp = value; editor.sync(layout, placeText(layout, 720, 405, appearance.position), false); },
    get appearance() { return appearance; }, get paused() { return paused; },
    get starts() { return starts; }, get stops() { return stops; }, get changes() { return changes; }
  };
}

test("a tap keeps automatic placement and dragging with mouse or touch fixes the visible position", (t) => {
  const env = setup(t);
  env.emit("text-overlay", "pointerdown");
  assert.equal(env.paused, true);
  env.emit("text-overlay", "pointerup");
  assert.equal(env.paused, false);
  assert.equal(env.appearance.position, null);
  for (const pointerType of ["mouse", "touch"]) {
    env.emit("text-reset", "click");
    env.emit("text-overlay", "pointerdown", { pointerType });
    const before = env.changes;
    for (let n = 0; n < 10; n += 1) env.emit("text-overlay", "pointermove", { pointerType, clientX: 371, clientY: 100 + n });
    assert.equal(env.changes, before);
    env.tick();
    assert.equal(env.changes, before + 1);
    assert.equal(env.appearance.position.x, 0.5);
    assert.equal(env.elements["text-overlay"].classes.has("is-dragging"), true);
    env.emit("text-overlay", "pointerup", { pointerType, clientX: 371, clientY: 109 });
    assert.equal(env.editor.interacting, false);
    assert.equal(env.paused, false);
    assert.equal(env.appearance.scale, DEFAULT_APPEARANCE.scale);
  }
  assert.equal(env.starts, env.stops);
});

test("Text motion defaults on, freezes the visible position when unchecked, and only appears on moving templates", (t) => {
  const env = setup(t);
  assert.equal(env.elements["text-motion"].checked, true);
  assert.equal(env.elements["text-motion-option"].hidden, false);
  env.elements["text-motion"].checked = false;
  env.emit("text-motion", "change");
  assert.ok(env.appearance.position);
  assert.equal(env.appearance.alignment, "right");
  assert.equal(env.elements["text-motion"].checked, false);
  env.elements["text-motion"].checked = true;
  env.emit("text-motion", "change");
  assert.equal(env.appearance.position, null);
  env.emit("text-overlay", "pointerdown");
  env.emit("text-overlay", "pointerup", { clientX: 371, clientY: 223.5 });
  assert.equal(env.elements["text-motion"].checked, false);
  env.setTemplate({ hasTextMotion: false });
  assert.equal(env.elements["text-motion-option"].hidden, true);
  env.setTemplate({ hasTextMotion: true });
  assert.equal(env.elements["text-motion"].checked, false);
});

test("cancellation releases capture, export locks controls, and Reset preserves content ownership", (t) => {
  const env = setup(t);
  env.emit("text-overlay", "pointerdown", { pointerType: "touch" });
  env.emit("text-overlay", "pointermove", { clientX: 500, clientY: 100 });
  env.emit("text-overlay", "pointercancel");
  assert.equal(env.editor.interacting, false);
  assert.equal(env.paused, false);
  assert.equal(env.elements["text-overlay"].captured.size, 0);
  env.setBusy(true);
  assert.equal(env.elements["text-appearance"].disabled, true);
  assert.equal(env.elements["text-overlay"].tabIndex, -1);
  env.emit("text-overlay", "pointerdown");
  assert.equal(env.editor.interacting, false);
  env.setBusy(false);
  assert.equal(env.elements["text-appearance"].disabled, false);
  env.alignments[0].dispatchEvent(new Event("click"));
  assert.equal(env.appearance.alignment, "left");
  env.emit("text-reset", "click");
  assert.deepEqual(env.appearance, normalizeAppearance());
});

test("keyboard can move one pixel away from center without snapping back", (t) => {
  const env = setup(t);
  env.emit("text-overlay", "pointerdown");
  env.emit("text-overlay", "pointerup", { clientX: 371, clientY: 223.5 });
  assert.equal(env.appearance.position.x, 0.5);
  env.emit("text-overlay", "keydown", { key: "ArrowRight" });
  assert.ok(Math.abs(env.appearance.position.x - (0.5 + 1 / 720)) < 0.00001);
  env.emit("text-overlay", "keydown", { key: "ArrowDown", shiftKey: true });
  assert.ok(Math.abs(env.appearance.position.y - (0.5 + 10 / 405)) < 0.00001);
});
