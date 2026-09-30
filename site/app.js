import { createFrameCleaner } from "./frame-cleaner.js";

const form = document.querySelector("#text-form");
const messageInput = document.querySelector("#message");
const previewText = document.querySelector("#preview-text");
const stage = document.querySelector("#stage");
const hamsterVideo = document.querySelector("#hamster-video");
const exportVideo = document.querySelector("#export-video");
const textMeasure = document.querySelector("#text-measure");
const status = document.querySelector("#status");
const downloadButton = document.querySelector("#download-button");
const downloadLabel = document.querySelector("#download-label");
const downloadIcon = document.querySelector("#download-icon");
const soundButton = document.querySelector("#sound-button");
const soundLabel = document.querySelector("#sound-label");
const soundIcon = document.querySelector("#sound-icon");
const playButton = document.querySelector("#play-button");
const playIcon = document.querySelector("#play-icon");
const shareButton = document.querySelector("#share-button");
const shareLabel = document.querySelector("#share-label");
const shareIcon = document.querySelector("#share-icon");
const characterStamp = document.querySelector("#character-stamp");
const actionMessage = document.querySelector("#action-message");
const exportCanvas = document.querySelector("#export-canvas");
const exportContext = exportCanvas.getContext("2d", { alpha: false });
const previewMeasureContext = document.createElement("canvas").getContext("2d");
const textLayoutCache = new Map();
const analysisCanvas = document.createElement("canvas");
analysisCanvas.width = 96;
analysisCanvas.height = 54;
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const cleanVideoFrame = createFrameCleaner();
const todayViewers = document.querySelector("#today-viewers");
const totalVisits = document.querySelector("#total-visits");
const siteStats = document.querySelector(".site-stats");

const OUTPUT_LONG_EDGE = 1280;
const EXPORT_VIDEO_BITRATE = 2_000_000;
// Keep the complete source timeline. Background cleanup removes the light
// matte without dropping the opening frames.
const CLEAN_VIDEO_START = 0;
let renderedUrl = "";
let rendering = false;
let soundEnabled = true;
let textSide = "right";
let audioContext;
let previewMediaSource;
let exportMediaSource;
let exportVersion = -1;
let recorderAudioDestination;
let monitorGain;
let renderedBlob;
let renderedFilename = "hamster-type.webm";
let messageVersion = 0;
let renderPending = false;
let downloadPending = false;
let exportSlide = 0;
let cleanEndFrame;
let downloadResetTimer;
let shareResetTimer;
let actionMessageTimer;
let editingText = false;
let manuallyPaused = false;

function showActionMessage(message) {
  actionMessage.textContent = message;
  actionMessage.classList.add("is-visible");
  window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.classList.remove("is-visible");
  }, 1800);
}

function cleanMessage() {
  return messageInput.value.trim();
}

function restartTextAnimation() {
  previewText.classList.remove("is-changing");
  void previewText.offsetWidth;
  previewText.classList.add("is-changing");
}

function positionPreviewText(animate = true) {
  if (!stage.clientWidth || !previewText.offsetWidth) return;
  const leftEdge = stage.clientWidth * 0.05;
  const rightEdge = stage.clientWidth * 0.95;
  const targetX = textSide === "right"
    ? Math.max(leftEdge, rightEdge - previewText.offsetWidth)
    : leftEdge;

  previewText.classList.toggle("no-transition", !animate);
  previewText.style.setProperty("--text-x", `${targetX}px`);
  if (!animate) requestAnimationFrame(() => previewText.classList.remove("no-transition"));
}

function setTextSide(side, animate = true) {
  if (side === textSide) {
    positionPreviewText(animate);
    return;
  }
  textSide = side;
  previewText.classList.toggle("is-right", side === "right");
  previewText.classList.toggle("is-left", side === "left");
  positionPreviewText(animate);
}

function measureCharacterBounds(video = rendering ? exportVideo : hamsterVideo) {
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
  return {
    left: minX / analysisCanvas.width,
    right: (maxX + 1) / analysisCanvas.width
  };
}

function sideOppositeCharacter() {
  const video = rendering ? exportVideo : hamsterVideo;
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
  const phase = ((video.currentTime - CLEAN_VIDEO_START) % duration) / duration;
  return phase < 0.32 || phase >= 0.72 ? "right" : "left";
}

function syncTextToCharacter() {
  if (!hamsterVideo.duration) return;
  const nextSide = sideOppositeCharacter();
  if (nextSide !== textSide) setTextSide(nextSide);
}

function updateLivePreview() {
  layoutPreviewText();
  textMeasure.textContent = messageInput.value || "";
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(320, Math.max(118, messageInput.scrollHeight))}px`;
  textMeasure.style.height = messageInput.style.height;
  restartTextAnimation();
  messageVersion += 1;
  downloadButton.classList.remove("is-disabled");
  downloadButton.setAttribute("aria-disabled", "false");
  shareButton.disabled = false;

  if (renderedUrl) {
    URL.revokeObjectURL(renderedUrl);
    renderedUrl = "";
    renderedBlob = undefined;
    downloadButton.href = "#";
    status.textContent = "Ready to export";
  }
  if (!rendering) status.textContent = "Ready to export";
}

function playPreview() {
  if (!editingText && !manuallyPaused && !rendering) hamsterVideo.play().catch(() => {});
}

function updatePlayButton() {
  const paused = hamsterVideo.paused;
  stage.classList.toggle("is-paused", paused);
  playButton.setAttribute("aria-label", paused ? "Play video" : "Pause video");
  playButton.title = paused ? "Play video" : "Pause video";
  playIcon.innerHTML = paused
    ? '<path d="m7 4.5 8 5.5-8 5.5z" />'
    : '<path d="M6.5 4.5v11m7-11v11" />';
}

function togglePlayback() {
  if (hamsterVideo.paused) {
    manuallyPaused = false;
    playPreview();
  } else {
    manuallyPaused = true;
    hamsterVideo.pause();
  }
}

function pauseWhileEditing() {
  editingText = true;
  hamsterVideo.pause();
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
  if (!hamsterVideo.videoWidth || !hamsterVideo.videoHeight) return;
  stage.style.setProperty("--stage-ratio", `${hamsterVideo.videoWidth} / ${hamsterVideo.videoHeight}`);
  requestAnimationFrame(layoutPreviewText);
}

async function prepareAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
    previewMediaSource = audioContext.createMediaElementSource(hamsterVideo);
    exportMediaSource = audioContext.createMediaElementSource(exportVideo);
    recorderAudioDestination = audioContext.createMediaStreamDestination();
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = soundEnabled ? 0.82 : 0;
    exportMediaSource.connect(recorderAudioDestination);
    previewMediaSource.connect(monitorGain);
    monitorGain.connect(audioContext.destination);
    hamsterVideo.muted = false;
    exportVideo.muted = false;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

async function toggleSound() {
  await prepareAudio();
  soundEnabled = !soundEnabled;
  monitorGain.gain.setTargetAtTime(soundEnabled ? 0.82 : 0, audioContext.currentTime, 0.018);
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
  soundIcon.classList.toggle("is-on", soundEnabled);
  soundIcon.innerHTML = soundEnabled
    ? '<path d="M3 8h3l4-3v10l-4-3H3zM13 7.2a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10" />'
    : '<path d="M3 8h3l4-3v10l-4-3H3zM14 7l3 3m0 0-3 3" />';
  showActionMessage(soundEnabled ? "Sound on" : "Sound off");
  soundButton.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
  soundButton.title = soundEnabled ? "Turn sound off" : "Turn sound on";
}

function wrapText(context, text, maxWidth) {
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

function layoutText(context, text, width, height, topInset = 0) {
  const key = `${width}:${height}:${topInset}:${text}`;
  if (textLayoutCache.has(key)) return textLayoutCache.get(key);

  const maxWidth = width * 0.52;
  const maxHeight = Math.min(height * 0.78, height - topInset - 8);
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

function layoutPreviewText() {
  if (!stage.clientWidth || !stage.clientHeight) return;
  const topInset = window.innerWidth <= 820 || window.matchMedia("(hover: none)").matches ? 52 : 0;
  const layout = layoutText(previewMeasureContext, cleanMessage(), stage.clientWidth, stage.clientHeight, topInset);
  previewText.textContent = layout.lines.join("\n");
  previewText.style.fontSize = `${layout.size}px`;
  previewText.style.lineHeight = `${layout.lineHeight}px`;
  previewText.style.width = `${Math.ceil(layout.width + 1)}px`;
  previewText.style.top = `${(stage.clientHeight + topInset) / 2}px`;
  positionPreviewText(false);
}

function drawFrame(elapsedSeconds, message, canvas = exportCanvas, context = exportContext) {
  const width = canvas.width;
  const height = canvas.height;
  const { lines, widths, size, lineHeight } = layoutText(context, message, width, height);
  const totalHeight = lineHeight * lines.length;
  const startY = height * 0.5 - totalHeight * 0.5 + size * 0.78;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.textBaseline = "alphabetic";
  context.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  context.fillStyle = "#171714";

  const desiredSlide = sideOppositeCharacter() === "left" ? 1 : 0;
  exportSlide += (desiredSlide - exportSlide) * 0.16;
  context.textAlign = "left";

  lines.forEach((line, index) => {
    const delay = index * 0.1;
    const entryProgress = Math.max(0, Math.min(1, (elapsedSeconds - delay) / 0.55));
    const entryEase = 1 - Math.pow(1 - entryProgress, 3);
    const rightX = width * 0.95 - widths[index];
    const leftX = width * 0.05;
    const lineX = rightX + (leftX - rightX) * exportSlide + (1 - entryEase) * width * 0.035;
    context.globalAlpha = entryEase;
    context.fillText(line, lineX, startY + index * lineHeight);
  });

  context.globalAlpha = 1;
  context.textAlign = "left";
  const videoWidth = width * 1.08;
  const videoHeight = height * 1.08;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const activeVideo = rendering ? exportVideo : hamsterVideo;
  const videoEnd = activeVideo.duration || 0;
  const sourceFrame = cleanEndFrame && activeVideo.currentTime >= videoEnd - 0.04
    ? cleanEndFrame
    : activeVideo;
  const cleanedFrame = cleanVideoFrame(sourceFrame, width, height);
  context.drawImage(cleanedFrame, -width * 0.04, -height * 0.04, videoWidth, videoHeight);
}

function getRecorderMimeType() {
  const choices = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function waitForCleanVideoEnd() {
  return new Promise((resolve) => {
    const video = exportVideo;
    if ("requestVideoFrameCallback" in video) {
      const checkFrame = (_now, metadata) => {
        if (metadata.mediaTime >= video.duration - 0.03 || video.ended) {
          resolve();
          return;
        }
        video.requestVideoFrameCallback(checkFrame);
      };
      video.requestVideoFrameCallback(checkFrame);
      video.addEventListener("ended", resolve, { once: true });
      return;
    }

    const checkTime = () => {
      if (video.currentTime >= video.duration - 0.03 || video.ended) {
        video.removeEventListener("timeupdate", checkTime);
        resolve();
      }
    };
    video.addEventListener("timeupdate", checkTime);
    video.addEventListener("ended", resolve, { once: true });
  });
}

function monitorCleanPlayback() {
  if (!("requestVideoFrameCallback" in hamsterVideo)) return;
  hamsterVideo.requestVideoFrameCallback(() => {
    if (!rendering) syncTextToCharacter();
    monitorCleanPlayback();
  });
}

function setBusy(isBusy) {
  rendering = isBusy;
  status.classList.toggle("is-busy", isBusy);
  status.classList.remove("is-error");
  status.textContent = isBusy ? "Loading video for export" : "Ready";
}

async function makeVideo(event) {
  event?.preventDefault();
  if (rendering) {
    renderPending = true;
    return;
  }

  if (!window.MediaRecorder || !exportCanvas.captureStream) {
    status.classList.add("is-error");
    status.textContent = "Export needs Chrome, Edge, or Firefox";
    downloadPending = false;
    downloadLabel.textContent = "Download it";
    downloadButton.removeAttribute("aria-busy");
    return;
  }

  setBusy(true);
  downloadLabel.textContent = "Preparing…";
  downloadButton.setAttribute("aria-busy", "true");
  const renderVersion = messageVersion;
  const message = cleanMessage();

  try {
    await prepareAudio();
    exportVideo.load();
    if (exportVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise((resolve, reject) => {
        exportVideo.addEventListener("loadeddata", resolve, { once: true });
        exportVideo.addEventListener("error", reject, { once: true });
      });
    }

    const sourceWidth = exportVideo.videoWidth || 1080;
    const sourceHeight = exportVideo.videoHeight || 1080;
    const duration = exportVideo.duration || 9;
    const scale = OUTPUT_LONG_EDGE / Math.max(sourceWidth, sourceHeight);
    exportCanvas.width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
    exportCanvas.height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
    exportSlide = 0;

    exportVideo.loop = false;
    exportVideo.pause();
    await seekVideo(Math.max(0, duration - 0.08), exportVideo);
    cleanEndFrame = document.createElement("canvas");
    cleanEndFrame.width = sourceWidth;
    cleanEndFrame.height = sourceHeight;
    cleanEndFrame.getContext("2d", { alpha: true }).drawImage(exportVideo, 0, 0, sourceWidth, sourceHeight);
    await seekVideo(CLEAN_VIDEO_START, exportVideo);
    setTextSide("right", false);

    const canvasStream = exportCanvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...recorderAudioDestination.stream.getAudioTracks()
    ]);
    const mimeType = getRecorderMimeType();
    const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType, videoBitsPerSecond: EXPORT_VIDEO_BITRATE, audioBitsPerSecond: 64_000 } : undefined);
    const chunks = [];
    let animationFrame = 0;
    let lastProgress = -1;

    recorder.addEventListener("dataavailable", (chunkEvent) => {
      if (chunkEvent.data.size) chunks.push(chunkEvent.data);
    });

    const completed = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    const draw = () => {
      const elapsed = Math.max(0, exportVideo.currentTime - CLEAN_VIDEO_START);
      drawFrame(elapsed, message, exportCanvas, exportContext);
      const progress = Math.min(99, Math.floor(elapsed / duration * 100));
      if (progress !== lastProgress) {
        lastProgress = progress;
        downloadLabel.textContent = `Rendering ${progress}%`;
        status.textContent = `Rendering video ${progress}%`;
      }
      if (rendering && !exportVideo.ended) animationFrame = requestAnimationFrame(draw);
    };

    recorder.start(250);
    draw();
    await exportVideo.play();
    await waitForCleanVideoEnd();
    downloadLabel.textContent = "Finishing…";
    status.textContent = "Finishing video";
    exportVideo.pause();
    cancelAnimationFrame(animationFrame);
    // Paint one known-clean frame and let the canvas stream flush it before
    // stopping. This removes the final-frame flash/overlay glitch.
    drawFrame(Math.max(CLEAN_VIDEO_START, duration - 0.01), message, exportCanvas, exportContext);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    recorder.stop();
    await completed;

    canvasStream.getTracks().forEach((track) => track.stop());
    combinedStream.getVideoTracks().forEach((track) => track.stop());

    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    renderedBlob = blob;
    renderedFilename = blob.type.startsWith("video/mp4") ? "hamster-type.mp4" : "hamster-type.webm";
    downloadButton.download = renderedFilename;
    exportVersion = renderVersion;
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    renderedUrl = URL.createObjectURL(blob);
    if (renderVersion === messageVersion) {
      downloadButton.href = renderedUrl;
      downloadButton.classList.remove("is-disabled");
      downloadButton.setAttribute("aria-disabled", "false");
      // Keep Share available on desktop too; shareVideo has a download
      // fallback when the browser does not implement Web Share.
      shareButton.disabled = false;
      status.textContent = "Video ready";
      if (downloadPending) {
        downloadPending = false;
        renderPending = false;
        saveRenderedVideo();
      } else {
        downloadLabel.textContent = "Download it";
        downloadButton.removeAttribute("aria-busy");
      }
    } else {
      renderedBlob = undefined;
      URL.revokeObjectURL(renderedUrl);
      renderedUrl = "";
      downloadButton.href = "#";
      status.textContent = "Text changed—ready to export";
      renderPending = renderPending || downloadPending;
    }
    status.classList.remove("is-busy");
  } catch (error) {
    console.error(error);
    downloadPending = false;
    renderPending = false;
    downloadLabel.textContent = "Download it";
    downloadButton.removeAttribute("aria-busy");
    showActionMessage("Video export failed");
    status.classList.remove("is-busy");
    status.classList.add("is-error");
    status.textContent = "Couldn’t render—try again";
  } finally {
    rendering = false;
    exportVideo.pause();
    exportVideo.currentTime = CLEAN_VIDEO_START;
    playPreview();
    if (renderPending) {
      renderPending = false;
      window.setTimeout(() => makeVideo(), 0);
    }
  }
}

function downloadVideo(event) {
  event?.preventDefault();
  if (rendering) {
    downloadPending = true;
    downloadLabel.textContent = "Preparing...";
    downloadButton.setAttribute("aria-busy", "true");
    return;
  }
  if (!renderedBlob || exportVersion !== messageVersion) {
    downloadPending = true;
    downloadLabel.textContent = "Preparing...";
    downloadButton.setAttribute("aria-busy", "true");
    makeVideo();
    return;
  }

  saveRenderedVideo();
}

function saveRenderedVideo() {
  const url = renderedUrl || URL.createObjectURL(renderedBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = renderedFilename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  if (!renderedUrl) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  downloadLabel.textContent = "Downloaded";
  downloadButton.removeAttribute("aria-busy");
  downloadIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
  showActionMessage("Video downloaded");
  window.clearTimeout(downloadResetTimer);
  downloadResetTimer = window.setTimeout(() => {
    downloadLabel.textContent = "Download it";
    downloadButton.removeAttribute("aria-busy");
    downloadIcon.innerHTML = '<path d="M10 2v10m0 0 4-4m-4 4-4-4M3 16.5h14" />';
  }, 1600);
}

async function shareVideo() {
  const shareUrl = new URL(location.href);
  shareUrl.searchParams.set("text", messageInput.value.trim());
  shareUrl.searchParams.delete("name");
  const linkText = shareUrl.href;

  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(linkText);
        copied = true;
      } catch {
        // Clipboard access can exist but still be denied on insecure origins.
      }
    }
    if (!copied) {
      const helper = document.createElement("textarea");
      helper.value = linkText;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      copied = document.execCommand("copy");
      helper.remove();
    }
    if (!copied) throw new Error("Clipboard copy was denied");
    status.textContent = "Link copied";
    showActionMessage("Link copied");
    shareLabel.textContent = "Copied";
    shareIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
    window.clearTimeout(shareResetTimer);
    shareResetTimer = window.setTimeout(() => {
      shareLabel.textContent = "Copy link";
      shareIcon.innerHTML = '<rect x="7" y="6" width="10" height="11" rx="1.5" /><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14H7" />';
    }, 1600);
  } catch (error) {
    console.error(error);
    status.textContent = "Copy the link from the address bar";
    showActionMessage("Copy failed");
  }
}

messageInput.addEventListener("input", () => {
  updateLivePreview();
  pauseWhileEditing();
});
messageInput.addEventListener("focus", pauseWhileEditing);
messageInput.addEventListener("blur", () => {
  editingText = false;
  window.setTimeout(playPreview, 0);
});
hamsterVideo.addEventListener("loadedmetadata", updateStageRatio);
hamsterVideo.addEventListener("play", updatePlayButton);
hamsterVideo.addEventListener("pause", updatePlayButton);
hamsterVideo.addEventListener("timeupdate", syncTextToCharacter);
hamsterVideo.addEventListener("seeked", syncTextToCharacter);
window.addEventListener("resize", layoutPreviewText);
// Browsers only allow audible autoplay after a user gesture. Keep sound enabled
// as the default preference and unlock the audio graph on the first gesture.
const unlockAudio = () => prepareAudio().catch(console.error);
document.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
document.addEventListener("keydown", unlockAudio, { once: true, capture: true });
soundButton.addEventListener("click", toggleSound);
playButton.addEventListener("click", togglePlayback);
stage.addEventListener("click", (event) => {
  if (!event.target.closest(".stage-controls")) togglePlayback();
});
shareButton.addEventListener("click", shareVideo);
characterStamp.addEventListener("click", () => {
  characterStamp.classList.add("is-selected");
  characterStamp.setAttribute("aria-pressed", "true");
  showActionMessage("Hamster character selected");
});
downloadButton.addEventListener("click", downloadVideo);
form.addEventListener("submit", (event) => event.preventDefault());

const sharedText = new URLSearchParams(location.search).get("text");
if (sharedText) messageInput.value = sharedText.slice(0, 240);
updateLivePreview();
updateStageRatio();
updatePlayButton();
monitorCleanPlayback();
loadVisitStats();
