import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloadDialog } from "../site/download-dialog.js";
import { MEMES } from "../site/memes.js";

test("returning users report the selected template after switching in either direction", async (t) => {
  const names = ["document", "window", "localStorage", "fetch"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  class Element extends EventTarget {
    constructor() {
      super();
      this.value = "";
      this.classList = { add() {}, toggle() {} };
      this.style = { setProperty() {} };
      this.clicks = 0;
    }
    setAttribute() {}
    removeAttribute() {}
    querySelector() { return new Element(); }
    click() { this.clicks += 1; }
  }
  const elements = new Map();
  globalThis.document = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  } };
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => "1" };
  const events = [];
  globalThis.fetch = async (url, options) => { events.push({ url, ...options, payload: JSON.parse(options.body) }); };
  let rendering = false;
  const dialog = createDownloadDialog({ isRendering: () => rendering });
  const form = elements.get("#download-email-form");
  form.elements = { format: { value: "video" } };
  const submit = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
  for (const [template, format] of [["baby-boo", "video"], ["speed", "gif"], ["baby-boo", "gif"]]) {
    dialog.setMeme(MEMES[template]);
    form.elements.format.value = format;
    submit();
    const event = events.at(-1);
    assert.equal(event.url, "/api/download-event");
    assert.equal(event.keepalive, true);
    assert.equal(event.payload.template, template);
    assert.equal(event.payload.format, format);
    assert.deepEqual(Object.keys(event.payload).sort(), ["format", "id", "template"]);
  }
  assert.equal(new Set(events.map((event) => event.payload.id)).size, 3);
  assert.equal(elements.get("#download-button").clicks, 1);
  assert.equal(elements.get("#gif-download-button").clicks, 2);
  rendering = true;
  submit();
  assert.equal(events.length, 3);
});
