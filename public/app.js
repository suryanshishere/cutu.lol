const form = document.querySelector("#text-form");
const messageInput = document.querySelector("#message");
const attributionInput = document.querySelector("#attribution");
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
const analysisCanvas = document.createElement("canvas");
analysisCanvas.width = 96;
analysisCanvas.height = 54;
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const todayViewers = document.querySelector("#today-viewers");
const totalVisits = document.querySelector("#total-visits");
const siteStats = document.querySelector(".site-stats");

const OUTPUT_LONG_EDGE = 1920;
// Skip the remaining white/transition frames at the very beginning.
const CLEAN_VIDEO_START = 1;
// Keep the full source timeline. The clean frame just before the baked
// end-card is held over that interval instead of trimming the export.
const CLEAN_CONTENT_END = 11.78;
const CLEAN_VIDEO_END = 12.767;
let renderedUrl = "";
let rendering = false;
let soundEnabled = false;
let textSide = "right";
let audioContext;
let mediaSource;
let recorderAudioDestination;
let monitorGain;
let renderTimer = 0;
let renderedBlob;
let messageVersion = 0;
let renderPending = false;
let exportSlide = 0;
let cleanEndFrame;
let downloadResetTimer;
let shareResetTimer;

function cleanMessage() {
  return messageInput.value.trim() || "Small steps. Big wheel energy.";
}

function cleanAttribution() {
  return attributionInput.value.trim();
}

function restartTextAnimation() {
  previewText.classList.remove("is-changing");
  void previewText.offsetWidth;
  previewText.classList.add("is-changing");
}

function positionPreviewText(animate = true) {
  if (!stage.clientWidth || !previewText.offsetWidth) return;
  const leftEdge = stage.clientWidth * 0.085;
  const rightEdge = stage.clientWidth * 0.915;
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

function measureCharacterBounds() {
  if (!hamsterVideo.videoWidth || !hamsterVideo.videoHeight) return null;
  analysisContext.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
  analysisContext.drawImage(hamsterVideo, 0, 0, analysisCanvas.width, analysisCanvas.height);
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
  const bounds = measureCharacterBounds();
  if (bounds) {
    const leftSpace = bounds.left;
    const rightSpace = 1 - bounds.right;
    // Keep the current side while the character is crossing the middle.
    // This hysteresis prevents a one-frame flip/jitter near the end of a run.
    const spaceDelta = rightSpace - leftSpace;
    if (Math.abs(spaceDelta) < 0.08) return textSide;
    return spaceDelta > 0 ? "right" : "left";
  }

  const phase = ((hamsterVideo.currentTime - CLEAN_VIDEO_START) % (CLEAN_VIDEO_END - CLEAN_VIDEO_START)) / (CLEAN_VIDEO_END - CLEAN_VIDEO_START);
  return phase < 0.32 || phase >= 0.72 ? "right" : "left";
}

function syncTextToCharacter() {
  if (!hamsterVideo.duration) return;
  if (!rendering && hamsterVideo.currentTime >= CLEAN_CONTENT_END) {
    hamsterVideo.currentTime = CLEAN_VIDEO_START;
    setTextSide("right", false);
    hamsterVideo.play().catch(() => {});
    return;
  }
  const nextSide = sideOppositeCharacter();
  if (nextSide !== textSide) setTextSide(nextSide);
}

function updateLivePreview() {
  previewText.replaceChildren(document.createTextNode(cleanMessage()));
  const attribution = cleanAttribution();
  if (attribution) {
    previewText.append(document.createElement("br"));
    const attributionNode = document.createElement("span");
    attributionNode.className = "preview-attribution";
    attributionNode.textContent = `— ${attribution}`;
    previewText.append(attributionNode);
  }
  restartTextAnimation();
  requestAnimationFrame(() => positionPreviewText(false));
  messageVersion += 1;
  // Keep the actions visible immediately; clicking while a fresh render is
  // pending simply schedules/continues that render.
  downloadButton.classList.remove("is-disabled");
  downloadButton.setAttribute("aria-disabled", "false");
  shareButton.disabled = false;

  if (renderedUrl) {
    URL.revokeObjectURL(renderedUrl);
    renderedUrl = "";
    renderedBlob = undefined;
    downloadButton.href = "#";
    status.textContent = "Preparing video";
  }
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  prepareAudio().catch(() => {});
  renderTimer = window.setTimeout(() => makeVideo(), 800);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function connectVisitorStats() {
  const productionHost = location.hostname === "outmatch.lol" || location.hostname === "www.outmatch.lol" || location.hostname.endsWith(".workers.dev") || location.port === "8787";
  if (!productionHost) {
    siteStats.classList.add("is-offline");
    return;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const sessionId = crypto.randomUUID();
  let reconnectDelay = 1_000;
  let socket;

  const openSocket = () => {
    socket = new WebSocket(`${protocol}//${location.host}/api/stats?session=${encodeURIComponent(sessionId)}`);
    socket.addEventListener("open", () => {
      reconnectDelay = 1_000;
      siteStats.classList.remove("is-offline");
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        todayViewers.textContent = formatCount(data.today);
        totalVisits.textContent = formatCount(data.total);
      } catch {
        siteStats.classList.add("is-offline");
      }
    });
    socket.addEventListener("close", () => {
      siteStats.classList.add("is-offline");
      window.setTimeout(openSocket, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    });
    socket.addEventListener("error", () => socket.close());
  };

  openSocket();
  window.addEventListener("pagehide", () => socket?.close(), { once: true });
}

function updateStageRatio() {
  if (!hamsterVideo.videoWidth || !hamsterVideo.videoHeight) return;
  stage.style.setProperty("--stage-ratio", `${hamsterVideo.videoWidth} / ${hamsterVideo.videoHeight}`);
  requestAnimationFrame(() => positionPreviewText(false));
}

async function prepareAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
    mediaSource = audioContext.createMediaElementSource(hamsterVideo);
    recorderAudioDestination = audioContext.createMediaStreamDestination();
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 0;
    mediaSource.connect(recorderAudioDestination);
    mediaSource.connect(monitorGain);
    monitorGain.connect(audioContext.destination);
    hamsterVideo.muted = false;
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
  soundButton.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
  if (hamsterVideo.paused && !rendering) await hamsterVideo.play();
}

function fitText(context, text, maxWidth, maxLines, initialSize) {
  let size = initialSize;
  const minSize = Math.max(28, initialSize * 0.42);
  let lines = [];

  while (size >= minSize) {
    context.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    lines = wrapText(context, text, maxWidth);
    if (lines.length <= maxLines) break;
    size -= Math.max(2, initialSize * 0.035);
  }

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length && context.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last.trim()}…`;
  }

  return { lines, size };
}

function wrapText(context, text, maxWidth) {
  const paragraphs = text.split(/\n+/);
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = words.shift();

    for (const word of words) {
      const candidate = `${line} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines.length ? lines : ["Small steps. Big wheel energy."];
}

function drawFrame(elapsedSeconds, message, canvas = exportCanvas, context = exportContext) {
  const width = canvas.width;
  const height = canvas.height;
  const fontBase = Math.min(width * 0.103, height * 0.16);
  const maxTextWidth = width * 0.64;
  const attribution = cleanAttribution();
  const { lines, size } = fitText(context, message, maxTextWidth, 4, fontBase);
  const lineHeight = size * 0.94;
  const attributionSize = Math.max(20, size * 0.32);
  const attributionLineHeight = attributionSize * 1.1;
  const attributionGap = attribution ? size * 0.16 : 0;
  const totalHeight = lineHeight * lines.length + attributionGap + (attribution ? attributionLineHeight : 0);
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
    const rightX = width * 0.915 - context.measureText(line).width;
    const leftX = width * 0.085;
    const lineX = rightX + (leftX - rightX) * exportSlide + (1 - entryEase) * width * 0.035;
    context.globalAlpha = entryEase;
    context.fillText(line, lineX, startY + index * lineHeight);
  });

  if (attribution) {
    const attributionProgress = Math.max(0, Math.min(1, (elapsedSeconds - lines.length * 0.1) / 0.55));
    const attributionEase = 1 - Math.pow(1 - attributionProgress, 3);
    context.font = `700 ${attributionSize}px Georgia, "Times New Roman", serif`;
    context.textAlign = desiredSlide < 0.5 ? "right" : "left";
    // Inset the attribution from the canvas edge so it sits beneath the
    // quote block instead of floating too far right.
    const attributionX = desiredSlide < 0.5 ? width * 0.855 : width * 0.145;
    context.globalAlpha = attributionEase;
    context.fillText(`— ${attribution}`, attributionX, startY + lines.length * lineHeight + attributionGap + attributionSize);
  }

  context.globalAlpha = 1;
  context.textAlign = "left";
  const videoWidth = width * 1.08;
  const videoHeight = height * 1.08;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const sourceFrame = cleanEndFrame && hamsterVideo.currentTime >= CLEAN_CONTENT_END
    ? cleanEndFrame
    : hamsterVideo;
  context.drawImage(sourceFrame, -width * 0.04, -height * 0.04, videoWidth, videoHeight);
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
    if ("requestVideoFrameCallback" in hamsterVideo) {
      const checkFrame = (_now, metadata) => {
        if (metadata.mediaTime >= CLEAN_VIDEO_END - 0.03 || hamsterVideo.ended) {
          resolve();
          return;
        }
        hamsterVideo.requestVideoFrameCallback(checkFrame);
      };
      hamsterVideo.requestVideoFrameCallback(checkFrame);
      return;
    }

    const checkTime = () => {
      if (hamsterVideo.currentTime < CLEAN_VIDEO_END - 0.03 && !hamsterVideo.ended) return;
      hamsterVideo.removeEventListener("timeupdate", checkTime);
      resolve();
    };
    hamsterVideo.addEventListener("timeupdate", checkTime);
  });
}

function monitorCleanPlayback() {
  if (!("requestVideoFrameCallback" in hamsterVideo)) return;
  hamsterVideo.requestVideoFrameCallback((_now, metadata) => {
    if (!rendering && metadata.mediaTime >= CLEAN_CONTENT_END) {
      hamsterVideo.currentTime = CLEAN_VIDEO_START;
      setTextSide("right", false);
      hamsterVideo.play().catch(() => {});
    } else if (!rendering) {
      syncTextToCharacter();
    }
    monitorCleanPlayback();
  });
}

function setBusy(isBusy) {
  rendering = isBusy;
  status.classList.toggle("is-busy", isBusy);
  status.classList.remove("is-error");
  status.textContent = isBusy ? "Preparing video" : "Ready";
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
    return;
  }

  setBusy(true);
  const renderVersion = messageVersion;

  try {
    await prepareAudio();
    if (hamsterVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise((resolve, reject) => {
        hamsterVideo.addEventListener("loadeddata", resolve, { once: true });
        hamsterVideo.addEventListener("error", reject, { once: true });
      });
    }

    const sourceWidth = hamsterVideo.videoWidth || 1080;
    const sourceHeight = hamsterVideo.videoHeight || 1080;
    const scale = OUTPUT_LONG_EDGE / Math.max(sourceWidth, sourceHeight);
    exportCanvas.width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
    exportCanvas.height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
    exportSlide = 0;

    hamsterVideo.loop = false;
    hamsterVideo.pause();
    await seekVideo(CLEAN_CONTENT_END - 0.08);
    cleanEndFrame = document.createElement("canvas");
    cleanEndFrame.width = sourceWidth;
    cleanEndFrame.height = sourceHeight;
    cleanEndFrame.getContext("2d", { alpha: true }).drawImage(hamsterVideo, 0, 0, sourceWidth, sourceHeight);
    hamsterVideo.currentTime = CLEAN_VIDEO_START;
    await new Promise((resolve) => hamsterVideo.addEventListener("seeked", resolve, { once: true }));
    setTextSide("right", false);

    const canvasStream = exportCanvas.captureStream(60);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...recorderAudioDestination.stream.getAudioTracks()
    ]);
    const mimeType = getRecorderMimeType();
    const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 } : undefined);
    const chunks = [];
    const message = cleanMessage();
    let animationFrame = 0;
    let startedAt = performance.now();

    recorder.addEventListener("dataavailable", (chunkEvent) => {
      if (chunkEvent.data.size) chunks.push(chunkEvent.data);
    });

    const completed = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    const draw = (now) => {
      drawFrame((now - startedAt) / 1000, message);
      if (rendering && !hamsterVideo.ended) animationFrame = requestAnimationFrame(draw);
    };

    recorder.start(250);
    startedAt = performance.now();
    draw(startedAt);
    await hamsterVideo.play();
    await waitForCleanVideoEnd();
    hamsterVideo.pause();
    cancelAnimationFrame(animationFrame);
    // Paint one known-clean frame and let the canvas stream flush it before
    // stopping. This removes the final-frame flash/overlay glitch.
    drawFrame(Math.max(CLEAN_VIDEO_START, CLEAN_VIDEO_END - 0.01), message);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    recorder.stop();
    await completed;

    canvasStream.getTracks().forEach((track) => track.stop());
    combinedStream.getVideoTracks().forEach((track) => track.stop());

    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    renderedBlob = blob;
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
    } else {
      renderPending = true;
    }
    status.classList.remove("is-busy");
  } catch (error) {
    console.error(error);
    status.classList.remove("is-busy");
    status.classList.add("is-error");
    status.textContent = "Couldn’t render—try again";
  } finally {
    rendering = false;
    hamsterVideo.loop = false;
    hamsterVideo.currentTime = CLEAN_VIDEO_START;
    hamsterVideo.play().catch(() => {});
    if (renderPending) {
      renderPending = false;
      window.setTimeout(() => makeVideo(), 0);
    }
  }
}

function downloadVideo(event) {
  event?.preventDefault();
  if (!renderedBlob) {
    scheduleRender();
    return;
  }

  const url = renderedUrl || URL.createObjectURL(renderedBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hamster-type.webm";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  if (!renderedUrl) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  downloadLabel.textContent = "Downloaded";
  downloadIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
  window.clearTimeout(downloadResetTimer);
  downloadResetTimer = window.setTimeout(() => {
    downloadLabel.textContent = "Download it";
    downloadIcon.innerHTML = '<path d="M10 2v10m0 0 4-4m-4 4-4-4M3 16.5h14" />';
  }, 1600);
}

function gifLzw(indices) {
  const clearCode = 256;
  const endCode = 257;
  let codeSize = 9;
  let nextCode = 258;
  let dictionary = new Map();
  const bytes = [];
  let buffer = 0;
  let bits = 0;

  const writeCode = (code) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(buffer & 255);
      buffer >>= 8;
      bits -= 8;
    }
  };
  const reset = () => {
    dictionary = new Map();
    codeSize = 9;
    nextCode = 258;
  };

  writeCode(clearCode);
  let current = String.fromCharCode(indices[0]);
  for (let index = 1; index < indices.length; index += 1) {
    const next = String.fromCharCode(indices[index]);
    const joined = current + next;
    if (dictionary.has(joined)) {
      current = joined;
      continue;
    }

    writeCode(current.length === 1 ? current.charCodeAt(0) : dictionary.get(current));
    if (nextCode < 4096) {
      dictionary.set(joined, nextCode);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writeCode(clearCode);
      reset();
    }
    current = next;
  }
  writeCode(current.length === 1 ? current.charCodeAt(0) : dictionary.get(current));
  writeCode(endCode);
  if (bits) bytes.push(buffer & 255);

  const blocks = [8];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const block = bytes.slice(offset, offset + 255);
    blocks.push(block.length, ...block);
  }
  blocks.push(0);
  return blocks;
}

function encodeShareGif(frames, width, height, fps) {
  const bytes = [...new TextEncoder().encode("GIF89a")];
  const push16 = (value) => bytes.push(value & 255, (value >> 8) & 255);
  push16(width);
  push16(height);
  bytes.push(0xf7, 0, 0);
  for (let color = 0; color < 256; color += 1) {
    bytes.push(
      Math.round(((color >> 5) & 7) * 255 / 7),
      Math.round(((color >> 2) & 7) * 255 / 7),
      (color & 3) * 85
    );
  }
  bytes.push(0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 0x03, 0x01, 0, 0, 0);
  const delay = Math.max(1, Math.round(100 / fps));
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x00, delay & 255, (delay >> 8) & 255, 0x00, 0x00);
    bytes.push(0x2c, 0, 0, 0, 0, width & 255, (width >> 8) & 255, height & 255, (height >> 8) & 255, 0x00);
    bytes.push(...gifLzw(frame));
  }
  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

function seekVideo(time) {
  return new Promise((resolve) => {
    if (Math.abs(hamsterVideo.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => resolve();
    hamsterVideo.addEventListener("seeked", onSeeked, { once: true });
    hamsterVideo.currentTime = time;
  });
}

async function createShareGif(message) {
  const width = 480;
  const height = 270;
  const fps = 10;
  const duration = Math.min(5.4, CLEAN_VIDEO_END - CLEAN_VIDEO_START - 0.08);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const originalTime = hamsterVideo.currentTime;
  const wasPaused = hamsterVideo.paused;
  hamsterVideo.pause();
  const frames = [];

  try {
    for (let frame = 0; frame < Math.ceil(duration * fps); frame += 1) {
      const elapsed = frame / fps;
      await seekVideo(CLEAN_VIDEO_START + elapsed);
      drawFrame(elapsed, message, canvas, context);
      const pixels = context.getImageData(0, 0, width, height).data;
      const indexed = new Uint8Array(width * height);
      for (let pixel = 0, offset = 0; pixel < indexed.length; pixel += 1, offset += 4) {
        indexed[pixel] = ((pixels[offset] >> 5) << 5) | ((pixels[offset + 1] >> 5) << 2) | (pixels[offset + 2] >> 6);
      }
      frames.push(indexed);
    }
  } finally {
    await seekVideo(Math.min(originalTime, CLEAN_VIDEO_END - 0.01));
    if (!wasPaused) hamsterVideo.play().catch(() => {});
  }
  return encodeShareGif(frames, width, height, fps);
}

async function shareVideo() {
  const shareUrl = new URL(location.href);
  shareUrl.searchParams.set("text", messageInput.value.trim());
  const attribution = attributionInput.value.trim();
  if (attribution) shareUrl.searchParams.set("name", attribution);
  else shareUrl.searchParams.delete("name");
  const linkText = shareUrl.href;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(linkText);
    } else {
      const helper = document.createElement("textarea");
      helper.value = linkText;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    status.textContent = "Link copied";
    shareLabel.textContent = "Copied";
    shareIcon.innerHTML = '<path d="m5 10 3.2 3.2L15.5 6" />';
    window.clearTimeout(shareResetTimer);
    shareResetTimer = window.setTimeout(() => {
      shareLabel.textContent = "Copy link";
      shareIcon.innerHTML = '<path d="M7 13 13.5 6.5M9 5h6v6M14 11v4H5V6h4" />';
    }, 1600);
  } catch (error) {
    console.error(error);
    status.textContent = "Copy the link from the address bar";
  }
}

messageInput.addEventListener("input", () => {
  updateLivePreview();
  scheduleRender();
});
attributionInput.addEventListener("input", () => {
  updateLivePreview();
  scheduleRender();
});
hamsterVideo.addEventListener("loadedmetadata", updateStageRatio);
hamsterVideo.addEventListener("timeupdate", syncTextToCharacter);
hamsterVideo.addEventListener("seeked", syncTextToCharacter);
window.addEventListener("resize", () => positionPreviewText(false));
soundButton.addEventListener("click", toggleSound);
shareButton.addEventListener("click", shareVideo);
downloadButton.addEventListener("click", downloadVideo);
form.addEventListener("submit", (event) => event.preventDefault());

const sharedText = new URLSearchParams(location.search).get("text");
const sharedName = new URLSearchParams(location.search).get("name");
if (sharedText) messageInput.value = sharedText.slice(0, 240);
if (sharedName) attributionInput.value = sharedName.slice(0, 48);
if (sharedText || sharedName) {
  updateLivePreview();
  scheduleRender();
}
updateStageRatio();
monitorCleanPlayback();
connectVisitorStats();
