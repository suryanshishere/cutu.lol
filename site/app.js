import { MEMES, DEFAULT_STAMP, MAX_TEXT_LENGTH, FRAME_ASPECT_RATIO, getMeme, normalizeText, readMemeUrl } from "./memes.js";
import { layoutText, placeText, textLineX, textRuns } from "./text-layout.js";
import { normalizeAppearance, restoreAppearance, saveAppearance } from "./text-appearance.js";
import { createTextEditor } from "./text-editor.js";
import { createMediaController } from "./media.js";
import { createDownloadDialog } from "./download-dialog.js";
import { createSharingController } from "./sharing.js";

const form = document.querySelector("#text-form");
const messageInput = document.querySelector("#message");
const previewText = document.querySelector("#preview-text");
const stage = document.querySelector("#stage");
const previewVideo = document.querySelector("#meme-video");
const exportVideo = document.querySelector("#export-video");
const status = document.querySelector("#status");
const stampButtons = [...document.querySelectorAll(".character-stamp[data-stamp]")];
const actionMessage = document.querySelector("#action-message");
const previewMeasureContext = document.createElement("canvas").getContext("2d");
const analysisCanvas = document.createElement("canvas");
const todayViewers = document.querySelector("#today-viewers");
const totalVisits = document.querySelector("#total-visits");
const siteStats = document.querySelector(".site-stats");
analysisCanvas.width = 96;
analysisCanvas.height = 54;
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
let selectedStamp = DEFAULT_STAMP;
let textSide = "right";
let messageVersion = 0;
let actionMessageTimer;
const initial = readMemeUrl(new URL(location.href));
let appearance = restoreAppearance(new URL(location.href), initial.appearance);
let previewLayout;
const getStamp = () => getMeme(selectedStamp);
const getMessage = () => normalizeText(messageInput.value) || getStamp().defaultText;
const getAppearance = () => appearance;
const downloads = createDownloadDialog({ isRendering: () => media.rendering });
const media = createMediaController({
  getStamp, getMessage, getAppearance, getMessageVersion: () => messageVersion,
  sideOppositeCharacter, setTextSide, syncTextToCharacter, showActionMessage, downloads,
  onExportChanged: () => sharing.updateShareLabel(),
  onBusyChanged: (busy) => editor.setBusy(busy)
});
const sharing = createSharingController({ media, getStamp, getMessage, getAppearance, showActionMessage });
const editor = createTextEditor({
  stage, previewText, getStamp, getAppearance, isRendering: () => media.rendering,
  beginGesture: media.beginTextGesture,
  onChange: (next) => {
    appearance = normalizeAppearance(next);
    saveAppearance(appearance);
    layoutPreviewText();
    invalidateDesign();
  }
});
function showActionMessage(message, duration = 1800) {
  actionMessage.classList.remove("is-visible");
  actionMessage.textContent = message;
  actionMessage.classList.toggle("is-guidance", duration !== 1800);
  void actionMessage.offsetWidth;
  actionMessage.classList.add("is-visible");
  window.clearTimeout(actionMessageTimer);
  if (duration) {
    actionMessageTimer = window.setTimeout(() => {
      actionMessage.classList.remove("is-visible");
    }, duration);
  }
}

function selectStamp(id, announce = true) {
  if (!Object.hasOwn(MEMES, id) || id === selectedStamp || media.rendering) return;
  if (messageInput.value === getStamp().defaultText || !normalizeText(messageInput.value)) {
    messageInput.value = getMeme(id).defaultText;
  }
  selectedStamp = id;
  const stamp = getMeme(id);
  for (const [video, sources] of [[previewVideo, stamp.preview], [exportVideo, stamp.export]]) {
    video.pause();
    video.replaceChildren(...sources.map(([src, type]) => {
      const source = document.createElement("source");
      source.src = src;
      source.type = type;
      return source;
    }));
    video.load();
  }
  media.resetSource();
  stage.dataset.stamp = id;
  stage.setAttribute("aria-label", `${stamp.name} Video Preview`);
  stampButtons.forEach((button) => {
    const selected = button.dataset.stamp === id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  downloads.setMeme(stamp);
  updateStageRatio();
  setTextSide("right", false);
  updateLivePreview();
  media.playPreview();
  if (announce) showActionMessage(`${stamp.name} stamp selected`);
}

function restartTextAnimation() {
  previewText.classList.remove("is-changing");
  void previewText.offsetWidth;
  previewText.classList.add("is-changing");
}

function positionPreviewText(animate = true) {
  if (!stage.clientWidth || !previewLayout) return;
  const placement = placeText(previewLayout, stage.clientWidth, stage.clientHeight, appearance.position, textSide, appearance.alignment);
  const fixed = Boolean(appearance.position);
  previewText.classList.toggle("no-transition", !animate || fixed);
  previewText.style.setProperty("--text-x", `${placement.x}px`);
  previewText.style.setProperty("--text-y", `${placement.y}px`);
  previewText.querySelectorAll("g").forEach((line, index) => {
    line.setAttribute("transform", `translate(${textLineX(previewLayout, index, placement.align)} 0)`);
  });
  editor.sync(previewLayout, placement, animate);
  if (!animate && !fixed) requestAnimationFrame(() => previewText.classList.remove("no-transition"));
}

function setTextSide(side, animate = true) {
  if (appearance.position) { positionPreviewText(false); return; }
  if (side === textSide) {
    positionPreviewText(animate);
    return;
  }
  textSide = side;
  previewText.classList.toggle("is-right", side === "right");
  previewText.classList.toggle("is-left", side === "left");
  positionPreviewText(animate);
}

function measureCharacterBounds(video = media.rendering ? exportVideo : previewVideo) {
  if (!video.videoWidth || !video.videoHeight) return null;
  analysisContext.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
  analysisContext.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const pixels = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
  let minX = analysisCanvas.width;
  let maxX = -1;
  let occupied = 0;

  for (let y = 0; y < analysisCanvas.height; y += 2) {
    for (let x = 0; x < analysisCanvas.width; x += 2) {
      const alpha = pixels[(y * analysisCanvas.width + x) * 4 + 3];
      if (alpha > 28) {
        occupied += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }

  const samples = (analysisCanvas.width / 2) * (analysisCanvas.height / 2);
  if (maxX < 0 || occupied > samples * 0.94) return null;
  const widthFraction = Math.min(1, (video.videoWidth / video.videoHeight) / FRAME_ASPECT_RATIO) * getStamp().scale;
  const inset = getStamp().anchor === "bottom-left" ? 0 : (1 - widthFraction) / 2;
  return {
    left: inset + minX / analysisCanvas.width * widthFraction,
    right: inset + (maxX + 1) / analysisCanvas.width * widthFraction
  };
}

function sideOppositeCharacter() {
  if (getStamp().anchor === "bottom-left") return "right";
  const video = media.rendering ? exportVideo : previewVideo;
  const bounds = measureCharacterBounds(video);
  if (bounds) {
    const leftSpace = bounds.left;
    const rightSpace = 1 - bounds.right;
    // Keep the current side while the character is crossing the middle.
    // This hysteresis prevents a one-frame flip/jitter near the end of a run.
    const spaceDelta = rightSpace - leftSpace;
    if (Math.abs(spaceDelta) < 0.08) return textSide;
    return spaceDelta > 0 ? "right" : "left";
  }

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 9;
  const phase = ((video.currentTime) % duration) / duration;
  return phase < 0.32 || phase >= 0.72 ? "right" : "left";
}

function syncTextToCharacter() {
  if (!previewVideo.duration || appearance.position || editor.interacting) return;
  const nextSide = sideOppositeCharacter();
  if (nextSide !== textSide) setTextSide(nextSide);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function loadVisitStats() {
  const data = window.__VISIT_STATS__;
  if (!data) {
    siteStats.classList.add("is-offline");
    return;
  }

  todayViewers.textContent = formatCount(data.today);
  totalVisits.textContent = formatCount(data.total);
  siteStats.classList.remove("is-offline");
}

function updateStageRatio() {
  const stamp = getStamp();
  stage.dataset.mediaAnchor = stamp.anchor;
  stage.classList.toggle("is-opaque-source", Boolean(stamp.opaqueSource && previewVideo.currentSrc && new URL(previewVideo.currentSrc).pathname === stamp.opaqueSource));
  stage.style.setProperty("--stage-ratio", String(FRAME_ASPECT_RATIO));
  previewVideo.style.setProperty("--video-scale", String(stamp.scale));
  requestAnimationFrame(layoutPreviewText);
}

function layoutPreviewText() {
  if (!stage.clientWidth || !stage.clientHeight) return;
  const layout = layoutText(previewMeasureContext, getMessage(), stage.clientWidth, stage.clientHeight, appearance);
  previewLayout = layout;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.style.overflow = "visible";
  layout.lines.forEach((_, index) => {
    const group = document.createElementNS(svg.namespaceURI, "g");
    textRuns(layout, index, appearance.alignment).forEach((run) => {
      const line = document.createElementNS(svg.namespaceURI, "text");
      line.textContent = run.text;
      line.setAttribute("x", String(run.x));
      line.setAttribute("y", String(layout.baseline + index * layout.lineHeight));
      group.append(line);
    });
    svg.append(group);
  });
  previewText.replaceChildren(svg);
  previewText.style.fontFamily = layout.font;
  previewText.style.fontSize = `${layout.size}px`;
  previewText.style.lineHeight = `${layout.lineHeight}px`;
  previewText.style.width = `${layout.width}px`;
  previewText.style.height = `${layout.height}px`;
  positionPreviewText(false);
}
function updateLivePreview() {
  layoutPreviewText();
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(320, Math.max(118, messageInput.scrollHeight))}px`;
  restartTextAnimation();
  invalidateDesign();
}
function invalidateDesign() {
  messageVersion += 1;
  media.invalidate();
  if (!media.rendering) downloads.resetDownloadState();
  actionMessage.classList.remove("is-visible");
  sharing.updateShareLabel();
  if (!media.rendering) status.textContent = "Ready to export";
}
messageInput.addEventListener("input", () => { updateLivePreview(); media.pauseWhileEditing(); });
messageInput.addEventListener("focus", media.pauseWhileEditing);
messageInput.addEventListener("blur", media.resumeAfterEditing);
previewVideo.addEventListener("loadedmetadata", updateStageRatio);
previewVideo.addEventListener("timeupdate", syncTextToCharacter);
previewVideo.addEventListener("seeked", syncTextToCharacter);
window.addEventListener("resize", layoutPreviewText);
stampButtons.forEach((button) => button.addEventListener("click", () => selectStamp(button.dataset.stamp)));
form.addEventListener("submit", (event) => event.preventDefault());
await editor.ready();
selectStamp(initial.meme.id, false);
messageInput.value = initial.message;
messageInput.maxLength = MAX_TEXT_LENGTH;
updateLivePreview();
updateStageRatio();
media.updatePlayButton();
media.updateSoundButton();
sharing.updateShareLabel();
media.startPreviewMuted();
media.monitorCleanPlayback();
loadVisitStats();
