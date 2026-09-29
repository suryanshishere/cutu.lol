import { CHARACTER_BOUNDS, CHARACTER_FPS } from "./hamster-bounds.js";

const messageInput = document.querySelector("#message");
const attributionInput = document.querySelector("#attribution");
const characterCount = document.querySelector("#character-count");
const previewText = document.querySelector("#preview-text");
const stage = document.querySelector("#stage");
const hamsterVideo = document.querySelector("#hamster-video");
const status = document.querySelector("#status");
const downloadButton = document.querySelector("#download-button");
const downloadLabel = document.querySelector("#download-label");
const downloadIcon = document.querySelector("#download-icon");
const soundButton = document.querySelector("#sound-button");
const soundLabel = document.querySelector("#sound-label");
const soundIcon = document.querySelector("#sound-icon");
const shareButton = document.querySelector("#share-button");
const shareLabel = document.querySelector("#share-label");
const shareIcon = document.querySelector("#share-icon");
const exportCanvas = document.querySelector("#export-canvas");
const exportContext = exportCanvas.getContext("2d", { alpha: false });
const measureCanvas = document.createElement("canvas");
const measureContext = measureCanvas.getContext("2d");
const siteStats = document.querySelector(".site-stats");
const todayViewers = document.querySelector("#today-viewers");
const totalVisits = document.querySelector("#total-visits");

const BACKGROUND = "#fffcf5";
const INK = "#26201b";
const ACCENT = "#ad8050";
let textSide = "right";
let messageVersion = 0;
let rendering = false;
let audioContext;
let recorderAudioDestination;
let monitorGain;
let soundEnabled = false;
let renderShift = 0;

const message = () => messageInput.value.trim();
const attribution = () => attributionInput.value.trim();

function wrapText(context, value, maxWidth) {
  const lines = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (context.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let piece = "";
      for (const character of word) {
        if (piece && context.measureText(piece + character).width > maxWidth) {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      line = piece;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fitQuote(context, value, signature, width, height) {
  const maxWidth = width * 0.41;
  const maxHeight = height * 0.72;
  let size = width * 0.073;
  let lines = [];
  for (; size >= width * 0.02; size -= width * 0.0025) {
    context.font = `700 ${size}px Georgia, serif`;
    lines = wrapText(context, value, maxWidth);
    const blockHeight = size * (0.8 + lines.length * 1.02 + (signature ? 0.9 : 0));
    if (lines.length <= 6 && blockHeight <= maxHeight) break;
  }
  return { lines, size: Math.max(size, width * 0.02) };
}

function renderPreviewText() {
  const value = message();
  characterCount.textContent = `${messageInput.value.length} / 120`;
  previewText.replaceChildren();
  if (!value || !stage.clientWidth) return;

  const { lines, size } = fitQuote(measureContext, value, attribution(), stage.clientWidth, stage.clientHeight);
  previewText.style.fontSize = `${size}px`;
  const mark = document.createElement("span");
  mark.className = "quote-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "“";
  const copy = document.createElement("span");
  copy.className = "quote-copy";
  copy.textContent = lines.join("\n");
  copy.style.whiteSpace = "pre-line";
  previewText.append(mark, copy);

  if (attribution()) {
    const signature = document.createElement("span");
    signature.className = "preview-attribution";
    signature.textContent = attribution();
    previewText.append(signature);
  }
}

function measureHamster() {
  const frame = Math.min(CHARACTER_BOUNDS.length - 1, Math.max(0, Math.round(hamsterVideo.currentTime * CHARACTER_FPS)));
  const bounds = CHARACTER_BOUNDS[frame];
  return bounds ? { left: bounds[0], right: bounds[1] } : null;
}

function sideAwayFromHamster(bounds = measureHamster()) {
  if (!bounds) return textSide;
  const roomOnRight = 1 - bounds.right;
  const roomOnLeft = bounds.left;
  if (Math.abs(roomOnRight - roomOnLeft) < 0.1) return textSide;
  return roomOnRight > roomOnLeft ? "right" : "left";
}

function shiftForSide(side, bounds) {
  if (!bounds) return 0;
  const left = 0.15 + bounds.left * 0.7;
  const right = 0.15 + bounds.right * 0.7;
  const shift = side === "right" ? Math.min(0, 0.51 - right) : Math.max(0, 0.49 - left);
  return Math.max(-0.22, Math.min(0.22, shift));
}

function syncTextSide() {
  if (!rendering) {
    const bounds = measureHamster();
    const side = sideAwayFromHamster(bounds);
    stage.style.setProperty("--hamster-shift", `${shiftForSide(side, bounds) * 100}%`);
    if (side !== textSide) {
      textSide = side;
      previewText.classList.toggle("is-right", side === "right");
      previewText.classList.toggle("is-left", side === "left");
    }
  }
  if ("requestVideoFrameCallback" in hamsterVideo) hamsterVideo.requestVideoFrameCallback(syncTextSide);
}

function drawFrame(layout, signature, elapsed) {
  const width = exportCanvas.width;
  const height = exportCanvas.height;
  const { lines, size } = layout;
  const bounds = measureHamster();
  const side = sideAwayFromHamster(bounds);
  const desiredShift = shiftForSide(side, bounds);
  renderShift += (desiredShift - renderShift) * 0.22;
  const x = width * (side === "right" ? 0.53 : 0.06);
  const nameHeight = signature ? size * 0.9 : 0;
  const blockHeight = size * (0.8 + lines.length * 1.02) + nameHeight;
  const top = (height - blockHeight) / 2;

  exportContext.fillStyle = BACKGROUND;
  exportContext.fillRect(0, 0, width, height);
  if (hamsterVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    exportContext.drawImage(hamsterVideo, width * (0.15 + renderShift), height * 0.15, width * 0.7, height * 0.7);
  }
  exportContext.globalAlpha = Math.min(1, elapsed / 0.32);
  exportContext.textAlign = "left";
  exportContext.textBaseline = "top";
  exportContext.fillStyle = ACCENT;
  exportContext.font = `700 ${size * 1.4}px Georgia, serif`;
  exportContext.fillText("“", x, top - size * 0.16);
  exportContext.fillStyle = INK;
  exportContext.font = `700 ${size}px Georgia, serif`;
  const lineTop = top + size * 0.8;
  lines.forEach((line, index) => exportContext.fillText(line, x, lineTop + index * size * 1.02));

  if (signature) {
    const ruleY = lineTop + lines.length * size * 1.02 + size * 0.16;
    exportContext.strokeStyle = "#bb9871";
    exportContext.lineWidth = Math.max(1, width / 1280);
    exportContext.beginPath();
    exportContext.moveTo(x, ruleY);
    exportContext.lineTo(x + width * 0.41, ruleY);
    exportContext.stroke();
    exportContext.fillStyle = "#6c5743";
    exportContext.font = `800 ${Math.max(30, size * 0.24)}px Arial, sans-serif`;
    exportContext.fillText(signature.toUpperCase(), x, ruleY + size * 0.24, width * 0.41);
  }
  exportContext.globalAlpha = 1;
}

async function prepareAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(hamsterVideo);
    recorderAudioDestination = audioContext.createMediaStreamDestination();
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 0;
    source.connect(recorderAudioDestination);
    source.connect(monitorGain);
    monitorGain.connect(audioContext.destination);
    hamsterVideo.muted = false;
  }
  if (audioContext.state === "suspended") await audioContext.resume();
}

async function toggleSound() {
  try {
    await prepareAudio();
    soundEnabled = !soundEnabled;
    monitorGain.gain.setTargetAtTime(soundEnabled ? 0.82 : 0, audioContext.currentTime, 0.018);
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
    soundLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
    soundIcon.innerHTML = soundEnabled
      ? '<path d="M3 8h3l4-3v10l-4-3H3zM13 7.2a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10" />'
      : '<path d="M3 8h3l4-3v10l-4 3H3zM14 7l3 3m0 0-3 3" />';
  } catch (error) {
    console.error(error);
    status.textContent = "Sound is unavailable in this browser.";
  }
}

function seekVideo(time) {
  return new Promise((resolve) => {
    if (Math.abs(hamsterVideo.currentTime - time) < 0.015) return resolve();
    hamsterVideo.addEventListener("seeked", resolve, { once: true });
    hamsterVideo.currentTime = time;
  });
}

function recorderType() {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function renderVideo(value, signature) {
  await prepareAudio();
  if (hamsterVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve, reject) => {
      hamsterVideo.addEventListener("loadeddata", resolve, { once: true });
      hamsterVideo.addEventListener("error", reject, { once: true });
    });
  }

  hamsterVideo.pause();
  hamsterVideo.loop = false;
  await seekVideo(0);
  exportCanvas.width = 1920;
  exportCanvas.height = 1080;
  const layout = fitQuote(exportContext, value, signature, exportCanvas.width, exportCanvas.height);
  renderShift = 0;
  drawFrame(layout, signature, 0);
  const videoStream = exportCanvas.captureStream(0);
  const canvasTrack = videoStream.getVideoTracks()[0];
  const stream = new MediaStream([...videoStream.getVideoTracks(), ...recorderAudioDestination.stream.getAudioTracks()]);
  const type = recorderType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  const ended = new Promise((resolve) => hamsterVideo.addEventListener("ended", resolve, { once: true }));
  let frameHandle;
  let paintedFrames = 0;
  let totalPaintMs = 0;
  let maxPaintMs = 0;
  const started = performance.now();
  const paint = (now) => {
    const paintStart = performance.now();
    drawFrame(layout, signature, (now - started) / 1000);
    const paintMs = performance.now() - paintStart;
    totalPaintMs += paintMs;
    maxPaintMs = Math.max(maxPaintMs, paintMs);
    canvasTrack.requestFrame();
    paintedFrames += 1;
  };

  try {
    recorder.start(250);
    paint(started);
    frameHandle = window.setInterval(() => paint(performance.now()), 1000 / 30);
    await hamsterVideo.play();
    await ended;
    window.clearInterval(frameHandle);
    drawFrame(layout, signature, hamsterVideo.duration);
    canvasTrack.requestFrame();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    if (!blob.size || paintedFrames < 90) throw new Error(`The recording captured only ${paintedFrames} frames over ${(performance.now() - started).toFixed(0)}ms. Paint total ${totalPaintMs.toFixed(0)}ms, max ${maxPaintMs.toFixed(0)}ms, page ${document.visibilityState}.`);
    return blob;
  } finally {
    window.clearInterval(frameHandle);
    if (recorder.state !== "inactive") recorder.stop();
    videoStream.getTracks().forEach((track) => track.stop());
    // The audio destination is reused on later downloads. Stopping its track
    // here would make every subsequent recording silent.
    hamsterVideo.loop = true;
    hamsterVideo.currentTime = 0;
    hamsterVideo.play().catch(() => {});
  }
}

async function downloadVideo() {
  if (rendering) return;
  if (!window.MediaRecorder || !exportCanvas.captureStream) {
    status.classList.add("is-error");
    status.textContent = "Video download needs a recent Chrome, Edge, or Firefox.";
    return;
  }
  rendering = true;
  downloadButton.disabled = true;
  downloadLabel.textContent = "Making video…";
  status.classList.remove("is-error");
  status.textContent = "Rendering with sound. Keep this tab in view for about 10 seconds.";
  const version = messageVersion;
  try {
    const blob = await renderVideo(message(), attribution());
    if (version !== messageVersion) {
      status.textContent = "Your message changed. Download again for the latest version.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "outmatch-hamster.webm";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = "Video downloaded.";
    window.gtag?.("event", "video_download");
    downloadLabel.textContent = "Downloaded";
    downloadIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
    window.setTimeout(() => {
      downloadLabel.textContent = "Download video";
      downloadIcon.innerHTML = '<path d="M10 2v10m0 0 4-4m-4 4-4-4M3 16.5h14" />';
    }, 2200);
  } catch (error) {
    console.error(error);
    status.classList.add("is-error");
    status.textContent = "Couldn’t make the video. Keep this tab in view and try again.";
  } finally {
    rendering = false;
    downloadButton.disabled = false;
    if (downloadLabel.textContent === "Making video…") downloadLabel.textContent = "Download video";
  }
}

async function shareVideo() {
  const url = new URL(location.href);
  url.searchParams.set("text", message());
  if (attribution()) url.searchParams.set("name", attribution());
  else url.searchParams.delete("name");
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = "Link copied. Anyone with it can make their own version.";
    window.gtag?.("event", "share_link");
    shareLabel.textContent = "Copied";
    shareIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
    window.setTimeout(() => {
      shareLabel.textContent = "Copy link";
      shareIcon.innerHTML = '<path d="m8 12 4-4m-5.3 6.3-1.4 1.4a3 3 0 0 1-4.2-4.2l2.4-2.4a3 3 0 0 1 4.2 4.2l-2.4 2.4a3 3 0 0 1-4.2 0" />';
    }, 1800);
  } catch (error) {
    console.error(error);
    status.classList.add("is-error");
    status.textContent = "Couldn’t copy the link. Try again.";
  }
}

function connectVisitorStats() {
  const production = ["outmatch.lol", "www.outmatch.lol"].includes(location.hostname)
    || location.hostname.endsWith(".workers.dev") || location.port === "8787";
  if (!production) {
    siteStats.classList.add("is-offline");
    return;
  }
  const sessionId = crypto.randomUUID();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  let retry = 1000;
  let leaving = false;
  let socket;
  const connect = () => {
    socket = new WebSocket(`${protocol}//${location.host}/api/stats?session=${sessionId}`);
    socket.addEventListener("open", () => { retry = 1000; siteStats.classList.remove("is-offline"); });
    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        todayViewers.textContent = new Intl.NumberFormat("en-IN").format(data.today || 0);
        totalVisits.textContent = new Intl.NumberFormat("en-IN").format(data.total || 0);
      } catch { siteStats.classList.add("is-offline"); }
    });
    socket.addEventListener("close", () => {
      siteStats.classList.add("is-offline");
      if (!leaving) window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    });
    socket.addEventListener("error", () => socket.close());
  };
  connect();
  window.addEventListener("pagehide", () => { leaving = true; socket?.close(); }, { once: true });
}

const params = new URLSearchParams(location.search);
if (params.has("text")) messageInput.value = params.get("text").slice(0, 120);
if (params.has("name")) attributionInput.value = params.get("name").slice(0, 36);
if (params.has("text") || params.has("name")) {
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("text");
  cleanUrl.searchParams.delete("name");
  history.replaceState(null, "", cleanUrl);
}

function startAnalytics() {
  if (!["outmatch.lol", "www.outmatch.lol"].includes(location.hostname)) return;
  const measurementId = "G-0XK4WXN0WR";
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { page_location: location.origin + location.pathname });
  const googleTag = document.createElement("script");
  googleTag.async = true;
  googleTag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(googleTag);

  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  const clarityTag = document.createElement("script");
  clarityTag.async = true;
  clarityTag.src = "https://www.clarity.ms/tag/ydhpx8ko1s";
  document.head.append(clarityTag);
}
messageInput.addEventListener("input", () => {
  if (messageInput.value.length > 120) messageInput.value = messageInput.value.slice(0, 120);
  messageVersion += 1;
  renderPreviewText();
});
attributionInput.addEventListener("input", () => { messageVersion += 1; renderPreviewText(); });
window.addEventListener("resize", renderPreviewText);
hamsterVideo.addEventListener("loadedmetadata", renderPreviewText);
hamsterVideo.addEventListener("loadeddata", syncTextSide, { once: true });
hamsterVideo.loop = true;
soundButton.addEventListener("click", toggleSound);
downloadButton.addEventListener("click", downloadVideo);
shareButton.addEventListener("click", shareVideo);
document.querySelector("#text-form").addEventListener("submit", (event) => event.preventDefault());
renderPreviewText();
connectVisitorStats();
startAnalytics();
