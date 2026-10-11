import { DEFAULT_APPEARANCE, TEXT_FONTS, loadTextFont, normalizeAppearance, clamp } from "./text-appearance.js";
import { clearTextLayoutCache, placeText } from "./text-layout.js";

export function createTextEditor({ stage, previewText, getStamp, getAppearance, onChange, isRendering, beginGesture }) {
  const overlay = document.querySelector("#text-overlay");
  const toolbar = document.querySelector("#text-appearance");
  const fontPicker = document.querySelector("#text-font");
  const slider = document.querySelector("#text-size");
  const sizeValue = document.querySelector("#text-size-value");
  const status = document.querySelector("#appearance-status");
  const motion = document.querySelector("#text-motion");
  const motionOption = document.querySelector("#text-motion-option");
  const resizeHandles = {
    width: document.querySelector("#text-resize-width"),
    height: document.querySelector("#text-resize-height"),
    both: document.querySelector("#text-resize-both")
  };
  const alignmentButtons = [...toolbar.querySelectorAll("[data-align]")];
  let layout;
  let resolvedAlignment = "right";
  let pointer = null;
  let basis;
  let frame = 0;
  let moved = false;
  let restorePlayback;
  let fontRequest = 0;
  let activeStamp = getStamp();

  function stagePoint(point) {
    const rect = stage.getBoundingClientRect();
    return { x: point.x - rect.left - stage.clientLeft, y: point.y - rect.top - stage.clientTop };
  }

  function currentCenter() {
    const rect = previewText.getBoundingClientRect();
    return stagePoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  function moveTo(center, snap = true) {
    let { x, y } = center;
    const snapX = snap && Math.abs(x - stage.clientWidth / 2) <= 8;
    const snapY = snap && Math.abs(y - stage.clientHeight / 2) <= 8;
    if (snapX) x = stage.clientWidth / 2;
    if (snapY) y = stage.clientHeight / 2;
    stage.classList.toggle("show-text-guide-x", snapX);
    stage.classList.toggle("show-text-guide-y", snapY);
    const position = { x: x / stage.clientWidth, y: y / stage.clientHeight };
    const placed = placeText(layout, stage.clientWidth, stage.clientHeight, position);
    onChange({
      ...getAppearance(),
      alignment: getAppearance().alignment === "auto" ? resolvedAlignment : getAppearance().alignment,
      position: {
        x: (placed.x + layout.width / 2) / stage.clientWidth,
        y: (placed.y + layout.height / 2) / stage.clientHeight
      }
    });
  }

  function applyPointerMove() {
    frame = 0;
    if (!pointer || isRendering()) return;
    const point = stagePoint(pointer);
    const dx = point.x - basis.point.x;
    const dy = point.y - basis.point.y;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    if (pointer.resize) {
      resizeTo(basis, pointer.resize, dx, dy);
      return;
    }
    overlay.classList.add("is-dragging");
    moveTo({ x: basis.center.x + dx, y: basis.center.y + dy });
  }

  function finishGesture() {
    cancelAnimationFrame(frame);
    frame = 0;
    const previous = pointer;
    pointer = null;
    const target = previous?.resize ? resizeHandles[previous.resize] : overlay;
    if (previous && target.hasPointerCapture(previous.id)) target.releasePointerCapture(previous.id);
    overlay.classList.remove("is-dragging");
    stage.classList.remove("show-text-guide-x", "show-text-guide-y");
    restorePlayback?.();
    restorePlayback = undefined;
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (isRendering() || !layout || pointer || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
    restorePlayback = beginGesture();
    overlay.focus({ preventScroll: true });
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    basis = { center: currentCenter(), point: stagePoint(pointer) };
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener("pointermove", (event) => {
    if (pointer?.id !== event.pointerId) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(applyPointerMove);
  });
  overlay.addEventListener("pointerup", (event) => {
    if (pointer?.id !== event.pointerId) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    cancelAnimationFrame(frame);
    applyPointerMove();
    finishGesture();
  });
  overlay.addEventListener("pointercancel", finishGesture);
  overlay.addEventListener("lostpointercapture", (event) => { if (pointer?.id === event.pointerId) finishGesture(); });
  overlay.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("keydown", (event) => {
    if (event.target !== overlay) return;
    if (event.key === "Escape") { finishGesture(); overlay.blur(); return; }
    if (isRendering() || !layout) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!Object.hasOwn(directions, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const center = currentCenter();
    const step = event.shiftKey ? 10 : 1;
    const [dx, dy] = directions[event.key];
    moveTo({ x: center.x + dx * step, y: center.y + dy * step }, false);
  });
  window.addEventListener("blur", finishGesture);
  window.addEventListener("resize", finishGesture);

  function resizeBasis() {
    const center = currentCenter();
    return { center, width: layout.width, height: layout.height, origin: { x: center.x - layout.width / 2, y: center.y - layout.height / 2 } };
  }

  function resizeTo(start, axis, dx, dy) {
    const width = axis === "height" ? start.width : clamp(start.width + dx, stage.clientWidth * 0.05, stage.clientWidth * 0.9);
    const height = axis === "width" ? start.height : clamp(start.height + dy, stage.clientHeight * 0.05, stage.clientHeight * 0.9);
    onChange({
      ...getAppearance(),
      alignment: getAppearance().alignment === "auto" ? resolvedAlignment : getAppearance().alignment,
      box: { width: width / stage.clientWidth, height: height / stage.clientHeight },
      position: { x: (start.origin.x + width / 2) / stage.clientWidth, y: (start.origin.y + height / 2) / stage.clientHeight }
    });
    status.textContent = `Text box resized to ${Math.round(width / stage.clientWidth * 100)}% wide and ${Math.round(height / stage.clientHeight * 100)}% high.`;
  }

  for (const [axis, handle] of Object.entries(resizeHandles)) {
    handle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (isRendering() || !layout || pointer || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      moved = false;
      restorePlayback = beginGesture();
      handle.focus({ preventScroll: true });
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, resize: axis };
      basis = { ...resizeBasis(), point: stagePoint(pointer) };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      event.stopPropagation();
      if (pointer?.id !== event.pointerId || pointer.resize !== axis) return;
      pointer = { ...pointer, x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(applyPointerMove);
    });
    handle.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (pointer?.id !== event.pointerId || pointer.resize !== axis) return;
      pointer = { ...pointer, x: event.clientX, y: event.clientY };
      cancelAnimationFrame(frame);
      applyPointerMove();
      finishGesture();
    });
    handle.addEventListener("pointercancel", (event) => { event.stopPropagation(); finishGesture(); });
    handle.addEventListener("lostpointercapture", (event) => { if (pointer?.id === event.pointerId) finishGesture(); });
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { finishGesture(); handle.blur(); return; }
      if (isRendering() || !layout) return;
      const step = event.shiftKey ? 10 : 1;
      const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!Object.hasOwn(directions, event.key)) return;
      event.preventDefault();
      const [dx, dy] = directions[event.key];
      if ((axis === "width" && !dx) || (axis === "height" && !dy)) return;
      resizeTo(resizeBasis(), axis, dx, dy);
    });
  }

  slider.addEventListener("input", () => {
    if (!isRendering()) onChange({ ...getAppearance(), scale: Number(slider.value) / 100 });
  });
  motion.addEventListener("change", () => {
    if (isRendering() || !getStamp().hasTextMotion || !layout) return;
    if (motion.checked) {
      onChange({ ...getAppearance(), position: null });
      status.textContent = "Text motion on";
    } else {
      moveTo(currentCenter(), false);
      status.textContent = "Text motion off. Text stays in place.";
    }
  });
  alignmentButtons.forEach((button) => button.addEventListener("click", () => {
    if (!isRendering()) onChange({ ...getAppearance(), alignment: button.dataset.align });
  }));
  fontPicker.addEventListener("change", async () => {
    if (isRendering()) return;
    const request = ++fontRequest;
    const fontId = fontPicker.value;
    fontPicker.setAttribute("aria-busy", "true");
    status.textContent = `Loading ${TEXT_FONTS[fontId].label}`;
    try {
      await loadTextFont(fontId);
      if (request !== fontRequest || isRendering()) return;
      clearTextLayoutCache();
      fontPicker.style.fontFamily = TEXT_FONTS[fontId].family;
      onChange({ ...getAppearance(), fontId });
      status.textContent = `${TEXT_FONTS[fontId].label} selected`;
    } catch {
      if (request === fontRequest) {
        fontPicker.value = getAppearance().fontId;
        status.textContent = "Couldn’t load this font. Please try again.";
      }
    } finally { if (request === fontRequest) fontPicker.removeAttribute("aria-busy"); }
  });
  document.querySelector("#text-reset").addEventListener("click", () => {
    if (isRendering()) return;
    fontRequest += 1;
    fontPicker.removeAttribute("aria-busy");
    finishGesture();
    onChange(normalizeAppearance(DEFAULT_APPEARANCE));
    status.textContent = "Text appearance reset. Automatic placement restored.";
  });

  return {
    get interacting() { return pointer !== null; },
    async ready() {
      const stamp = getStamp();
      const fontId = getAppearance().fontId;
      try { await loadTextFont(fontId); }
      catch {
        if (getStamp() === stamp && getAppearance().fontId === fontId) {
          onChange({ ...getAppearance(), fontId: "classic" });
          status.textContent = "Font unavailable. Using Classic.";
        }
      }
      clearTextLayoutCache();
    },
    setBusy(busy) {
      if (busy) { fontRequest += 1; finishGesture(); fontPicker.removeAttribute("aria-busy"); fontPicker.value = getAppearance().fontId; }
      toolbar.disabled = busy;
      for (const handle of Object.values(resizeHandles)) handle.disabled = busy;
      overlay.setAttribute("aria-disabled", String(busy));
      overlay.tabIndex = busy ? -1 : 0;
    },
    sync(nextLayout, placement, animate) {
      if (getStamp() !== activeStamp) {
        activeStamp = getStamp();
        fontRequest += 1;
        fontPicker.removeAttribute("aria-busy");
        finishGesture();
      }
      layout = nextLayout;
      resolvedAlignment = placement.align;
      const width = getAppearance().box ? layout.width : Math.max(44, layout.width);
      const height = getAppearance().box ? layout.height : Math.max(44, layout.height);
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.setProperty("--overlay-x", `${placement.x + (layout.width - width) / 2}px`);
      overlay.style.setProperty("--overlay-y", `${placement.y + (layout.height - height) / 2}px`);
      overlay.classList.toggle("no-transition", !animate || Boolean(getAppearance().position));
      overlay.classList.toggle("has-custom-box", Boolean(getAppearance().box));
      if (!animate && !getAppearance().position) requestAnimationFrame(() => overlay.classList.remove("no-transition"));
      const scale = getAppearance().box ? getAppearance().scale : layout.effectiveScale;
      slider.value = String(Math.round(scale * 100));
      sizeValue.value = `${Math.round(scale * 100)}%`;
      slider.setAttribute("aria-valuetext", sizeValue.value);
      if (fontPicker.getAttribute("aria-busy") !== "true") {
        fontPicker.value = getAppearance().fontId;
        fontPicker.style.fontFamily = TEXT_FONTS[getAppearance().fontId].family;
      }
      alignmentButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.align === placement.align)));
      motionOption.hidden = !getStamp().hasTextMotion;
      motion.checked = !getAppearance().position;
    }
  };
}
