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
const todayViewers = document.querySelector("#today-viewers");
const totalVisits = document.querySelector("#total-visits");
const siteStats = document.querySelector(".site-stats");

const DESKTOP_LONG_EDGE = 960;
const MOBILE_LONG_EDGE = 720;
// Keep the complete source timeline; the WebM already has a transparent matte.
const CLEAN_VIDEO_START = 0;
let renderedUrl = "";
let rendering = false;
let soundEnabled = true;
let soundUnlocked = false;
let textSide = "right";
let audioContext;
let previewMediaSource;
let exportMediaSource;
let exportVersion = -1;
let recorderAudioDestination;
let monitorGain;
let renderedBlob;
let renderedFilename = "hamster-type.mp4";
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
  updateShareLabel();
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
  stage.classList.toggle("is-opaque-source", hamsterVideo.currentSrc.endsWith("hamster-fallback.mp4"));
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
  }

  hamsterVideo.muted = false;
  exportVideo.muted = false;
  if (!editingText && !manuallyPaused && !rendering) hamsterVideo.play().catch(() => {});
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  if (audioContext.state !== "running") throw new Error("Audio is waiting for a browser gesture");
  soundUnlocked = true;
  updateSoundButton();
}

function updateSoundButton() {
  const audible = soundEnabled && soundUnlocked;
  soundButton.setAttribute("aria-pressed", String(audible));
  soundLabel.textContent = audible ? "Sound on" : soundEnabled ? "Tap for sound" : "Sound off";
  soundIcon.classList.toggle("is-on", audible);
  soundIcon.innerHTML = audible
    ? '<path d="M3 8h3l4-3v10l-4-3H3zM13 7.2a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10" />'
    : '<path d="M3 8h3l4-3v10l-4-3H3zM14 7l3 3m0 0-3 3" />';
  soundButton.setAttribute("aria-label", audible ? "Turn sound off" : "Turn sound on");
  soundButton.title = audible ? "Turn sound off" : soundEnabled ? "Tap for sound" : "Turn sound on";
  stage.classList.toggle("needs-sound", soundEnabled && !soundUnlocked);
}

async function toggleSound() {
  try {
    if (soundEnabled && !soundUnlocked) {
      await prepareAudio();
      playPreview();
    } else {
      soundEnabled = !soundEnabled;
      if (soundEnabled) await prepareAudio();
      if (monitorGain) monitorGain.gain.setTargetAtTime(soundEnabled ? 0.82 : 0, audioContext.currentTime, 0.018);
      hamsterVideo.muted = !soundEnabled;
    }
    updateSoundButton();
    showActionMessage(soundEnabled ? "Sound on" : "Sound off");
  } catch (error) {
    console.error(error);
    showActionMessage("Tap again for sound");
  }
}

async function startPreviewWithSound() {
  hamsterVideo.muted = false;
  try {
    await hamsterVideo.play();
    soundUnlocked = true;
  } catch {
    if (!soundUnlocked) {
      hamsterVideo.muted = true;
      await hamsterVideo.play().catch(() => {});
    }
  }
  updateSoundButton();
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
  const activeVideo = rendering ? exportVideo : hamsterVideo;
  const videoEnd = activeVideo.duration || 0;
  const sourceFrame = cleanEndFrame && activeVideo.currentTime >= videoEnd - 0.04
    ? cleanEndFrame
    : activeVideo;
  const opaqueSource = activeVideo.currentSrc.endsWith("hamster-fallback.mp4");
  const drawSource = () => {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(sourceFrame, -width * 0.04, -height * 0.04, width * 1.08, height * 1.08);
  };
  if (opaqueSource) drawSource();
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
  if (!opaqueSource) drawSource();
}

function seekVideo(time, video = hamsterVideo) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    video.addEventListener("seeked", resolve, { once: true });
    video.currentTime = time;
  });
}

function mobileSaveNeedsTap() {
  return navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
}

function renderedFile() {
  return new File([renderedBlob], renderedFilename, { type: renderedBlob.type });
}

function canShareRenderedVideo() {
  if (!mobileSaveNeedsTap() || !navigator.share || !navigator.canShare || !renderedBlob || exportVersion !== messageVersion) return false;
  try {
    return navigator.canShare({ files: [renderedFile()] });
  } catch {
    return false;
  }
}

function updateShareLabel() {
  const label = canShareRenderedVideo() ? "Share video" : navigator.share && mobileSaveNeedsTap() ? "Share link" : "Copy link";
  shareButton.setAttribute("aria-label", label);
  shareButton.title = label;
  shareLabel.textContent = label;
}

function createRecorder(stream, videoBitsPerSecond) {
  const choices = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  for (const mimeType of choices) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond: 64_000 });
    } catch {
      // Some browsers report a type as supported but reject its constructor.
    }
  }
  throw new Error("This browser cannot record MP4 or WebM video");
}

function waitForVideoEnd(video, duration) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("Video playback stalled")), Math.max(30_000, duration * 4000));
    const onEnded = () => finish();
    const onError = () => finish(video.error || new Error("Source video failed"));
    function finish(error) {
      window.clearTimeout(timeout);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
  });
}

function verifyRecording(blob, duration) {
  if (blob.size < 30_000) return Promise.reject(new Error("Recorded video is empty"));
  return new Promise((resolve, reject) => {
    const probe = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Recorded video could not be opened")), 8000);
    function finish(error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    }
    probe.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(probe.duration) && probe.duration < duration - 0.5) {
        finish(new Error("Recorded video ended early"));
      } else {
        finish();
      }
    }, { once: true });
    probe.addEventListener("error", () => finish(new Error("Recorded video is not playable")), { once: true });
    probe.preload = "metadata";
    probe.src = url;
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
  if (isBusy) hamsterVideo.pause();
  status.classList.toggle("is-busy", isBusy);
  status.classList.remove("is-error");
  status.textContent = isBusy ? "Loading video for export" : "Ready";
}

async function makeVideo(event) {
  event?.preventDefault();
  if (rendering) {
    showActionMessage("Video is already rendering");
    return;
  }

  if (!window.MediaRecorder || !exportCanvas.captureStream) {
    status.classList.add("is-error");
    status.textContent = "Video export is not supported in this browser";
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
  let canvasStream;
  let combinedStream;
  let recorder;
  let animationFrame = 0;

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
    const mobile = mobileSaveNeedsTap();
    const scale = (mobile ? MOBILE_LONG_EDGE : DESKTOP_LONG_EDGE) / Math.max(sourceWidth, sourceHeight);
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

    canvasStream = exportCanvas.captureStream(30);
    combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...recorderAudioDestination.stream.getAudioTracks()
    ]);
    recorder = createRecorder(combinedStream, mobile ? 1_400_000 : 2_000_000);
    const mimeType = recorder.mimeType || "video/webm";
    const chunks = [];
    let lastProgress = -10;

    recorder.addEventListener("dataavailable", (chunkEvent) => {
      if (chunkEvent.data.size) chunks.push(chunkEvent.data);
    });

    const completed = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", (event) => reject(event.error || new Error("Recording failed")), { once: true });
    });
    const draw = () => {
      const elapsed = Math.max(0, exportVideo.currentTime - CLEAN_VIDEO_START);
      drawFrame(elapsed, message, exportCanvas, exportContext);
      const progress = Math.min(90, Math.floor(elapsed / duration * 10) * 10);
      if (progress !== lastProgress) {
        lastProgress = progress;
        status.textContent = `Rendering video ${progress}%`;
      }
      if (rendering && !exportVideo.ended) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    recorder.start();
    downloadLabel.textContent = "Rendering video";
    drawFrame(0, message, exportCanvas, exportContext);
    await exportVideo.play();
    draw();
    await waitForVideoEnd(exportVideo, duration);
    downloadLabel.textContent = "Finishing…";
    status.textContent = "Finishing video";
    exportVideo.pause();
    cancelAnimationFrame(animationFrame);
    // Paint one known-clean frame and let the canvas stream flush it before
    // stopping. This removes the final-frame flash/overlay glitch.
    drawFrame(Math.max(CLEAN_VIDEO_START, duration - 0.01), message, exportCanvas, exportContext);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    recorder.stop();
    await completed;

    const blob = new Blob(chunks, { type: mimeType });
    await verifyRecording(blob, duration);
    renderedBlob = blob;
    renderedFilename = mimeType.startsWith("video/mp4") ? "hamster-type.mp4" : "hamster-type.webm";
    downloadButton.download = renderedFilename;
    exportVersion = renderVersion;
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    renderedUrl = URL.createObjectURL(blob);
    if (renderVersion === messageVersion) {
      downloadButton.href = renderedUrl;
      downloadButton.classList.remove("is-disabled");
      downloadButton.setAttribute("aria-disabled", "false");
      shareButton.disabled = false;
      updateShareLabel();
      status.textContent = mobile ? "Video ready. Tap Save video." : "Video ready";
      if (downloadPending) {
        downloadPending = false;
        renderPending = false;
        if (mobile) {
          downloadLabel.textContent = "Save video";
          downloadButton.removeAttribute("aria-busy");
          showActionMessage("Ready — tap Save video");
        } else {
          saveRenderedVideo();
        }
      } else {
        downloadLabel.textContent = "Save video";
        downloadButton.removeAttribute("aria-busy");
      }
    } else {
      renderedBlob = undefined;
      URL.revokeObjectURL(renderedUrl);
      renderedUrl = "";
      downloadButton.href = "#";
      updateShareLabel();
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
    cancelAnimationFrame(animationFrame);
    if (recorder?.state === "recording") recorder.stop();
    canvasStream?.getTracks().forEach((track) => track.stop());
    combinedStream?.getVideoTracks().forEach((track) => track.stop());
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
  if (rendering) {
    event.preventDefault();
    showActionMessage("Video is already rendering");
    return;
  }
  if (!renderedBlob || exportVersion !== messageVersion) {
    event.preventDefault();
    downloadPending = true;
    downloadLabel.textContent = "Preparing video";
    downloadButton.setAttribute("aria-busy", "true");
    makeVideo();
    return;
  }

  // Keep the browser's native anchor action inside this tap. Mobile browsers
  // may ignore a synthetic click made after an asynchronous render.
  status.textContent = "Download started";
  showActionMessage("Saving video");
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
  downloadLabel.textContent = "Download again";
  downloadButton.removeAttribute("aria-busy");
  downloadIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
  showActionMessage("Download started");
  window.clearTimeout(downloadResetTimer);
  downloadResetTimer = window.setTimeout(() => {
    downloadLabel.textContent = "Download again";
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
    if (navigator.share && mobileSaveNeedsTap()) {
      try {
        const fileShare = canShareRenderedVideo();
        await navigator.share(fileShare
          ? { title: "Baby Boo video", files: [renderedFile()] }
          : { title: "Baby Boo video", url: linkText });
        status.textContent = fileShare ? "Video shared" : "Link shared";
        showActionMessage(fileShare ? "Video shared" : "Link shared");
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
        // Use the copy flow when native sharing is unavailable.
      }
    }
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
      updateShareLabel();
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
// A browser may block audible autoplay. Keep sound requested by default and
// unlock it on the first gesture; the speaker button handles its own gesture.
const unlockAudio = (event) => {
  if (event.target.closest?.("#sound-button") || !soundEnabled || soundUnlocked) return;
  prepareAudio().then(playPreview).catch(console.error);
};
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
soundButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSound();
});
playButton.addEventListener("click", (event) => {
  event.stopPropagation();
  togglePlayback();
});
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
updateSoundButton();
updateShareLabel();
startPreviewWithSound();
monitorCleanPlayback();
loadVisitStats();
