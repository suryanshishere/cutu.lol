import { layoutText, placeText, textLineX, textRuns } from "./text-layout.js";
import { loadTextFont, normalizeAppearance } from "./text-appearance.js";
import { FRAME_ASPECT_RATIO } from "./memes.js";

export function mobileSaveNeedsTap() {
  return navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
}

export function createMediaController({ getStamp, getMessage, getAppearance, getMessageVersion, sideOppositeCharacter, setTextSide, syncTextToCharacter, showActionMessage, downloads, onExportChanged, onBusyChanged }) {
  const previewVideo = document.querySelector("#meme-video");
  const exportVideo = document.querySelector("#export-video");
  const stage = document.querySelector("#stage");
  const status = document.querySelector("#status");
  const exportCanvas = document.querySelector("#export-canvas");
  const exportContext = exportCanvas.getContext("2d", { alpha: false });
  const downloadButton = document.querySelector("#download-button");
  const downloadLabel = document.querySelector("#download-label");
  const gifDownloadButton = document.querySelector("#gif-download-button");
  const gifDownloadLabel = document.querySelector("#gif-download-label");
  const shareButton = document.querySelector("#share-button");
  const stampButtons = [...document.querySelectorAll(".character-stamp[data-stamp]")];
  const soundButton = document.querySelector("#sound-button");
  const soundLabel = document.querySelector("#sound-label");
  const soundIcon = document.querySelector("#sound-icon");
  const playButton = document.querySelector("#play-button");
  const playIcon = document.querySelector("#play-icon");
  const DESKTOP_LONG_EDGE = 960;
  const MOBILE_LONG_EDGE = 720;
  const GIF_LONG_EDGE = 480;
  const GIF_FPS = 10;
  const VIDEO_START = 0;
  let renderedUrl = "";
  let renderedGifUrl = "";
  let rendering = false;
  let soundEnabled = false;
  let soundUnlocked = false;
  let audioContext;
  let previewMediaSource;
  let exportMediaSource;
  let exportVersion = -1;
  let recorderAudioDestination;
  let monitorGain;
  let renderedBlob;
  let renderedFilename = "";
  let renderedGifBlob;
  let gifVersion = -1;
  let renderPending = false;
  let downloadPending = false;
  let gifDownloadPending = false;
  let exportSlide = 0;
  let cleanEndFrame;
  let editingText = false;
  let manuallyPaused = false;
  let editingAppearance = false;
  let exportAppearance;
  const { resetDownloadState, showDownloadProgress, showDownloadReady,
    showDownloadSaving, showDownloadError, openDownloadDialog } = downloads;
  function playPreview() {
    if (!editingText && !editingAppearance && !manuallyPaused && !rendering) previewVideo.play().catch(() => {});
  }

  function updatePlayButton() {
    const paused = previewVideo.paused;
    stage.classList.toggle("is-paused", paused);
    playButton.setAttribute("aria-label", paused ? "Play Video" : "Pause Video");
    playButton.title = paused ? "Play Video" : "Pause Video";
    playIcon.innerHTML = paused
      ? '<path d="m7 4.5 8 5.5-8 5.5z" />'
      : '<path d="M6.5 4.5v11m7-11v11" />';
  }

  function togglePlayback() {
    if (previewVideo.paused) {
      manuallyPaused = false;
      playPreview();
    } else {
      manuallyPaused = true;
      previewVideo.pause();
    }
  }

  function pauseWhileEditing() {
    editingText = true;
    previewVideo.pause();
  }

  function beginTextGesture() {
    const wasPlaying = !previewVideo.paused;
    editingAppearance = true;
    previewVideo.pause();
    return () => {
      editingAppearance = false;
      if (wasPlaying) playPreview();
    };
  }

  async function prepareAudio() {
    if (!getStamp().hasAudio) return;
    if (!audioContext) {
      audioContext = new AudioContext();
      previewMediaSource = audioContext.createMediaElementSource(previewVideo);
      exportMediaSource = audioContext.createMediaElementSource(exportVideo);
      recorderAudioDestination = audioContext.createMediaStreamDestination();
      monitorGain = audioContext.createGain();
      monitorGain.gain.value = soundEnabled ? 0.82 : 0;
      exportMediaSource.connect(recorderAudioDestination);
      previewMediaSource.connect(monitorGain);
      monitorGain.connect(audioContext.destination);
    }

    previewVideo.muted = false;
    exportVideo.muted = false;
    if (!editingText && !editingAppearance && !manuallyPaused && !rendering) previewVideo.play().catch(() => {});
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    if (audioContext.state !== "running") throw new Error("Audio is waiting for a browser gesture");
    soundUnlocked = true;
    updateSoundButton();
  }

  function updateSoundButton() {
    soundButton.hidden = !getStamp().hasAudio;
    stage.dataset.hasAudio = String(getStamp().hasAudio);
    const audible = soundEnabled && soundUnlocked;
    soundButton.setAttribute("aria-pressed", String(audible));
    soundLabel.textContent = audible ? "Sound On" : soundEnabled ? "Tap for Sound" : "Sound Off";
    soundIcon.classList.toggle("is-on", audible);
    soundIcon.innerHTML = audible
      ? '<path d="M3 8h3l4-3v10l-4-3H3zM13 7.2a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10" />'
      : '<path d="M3 8h3l4-3v10l-4-3H3zM14 7l3 3m0 0-3 3" />';
    soundButton.setAttribute("aria-label", audible ? "Turn Sound Off" : "Turn Sound On");
    soundButton.title = audible ? "Turn Sound Off" : soundEnabled ? "Tap for Sound" : "Turn Sound On";
    stage.classList.toggle("needs-sound", soundEnabled && !soundUnlocked);
  }

  async function toggleSound() {
    if (!getStamp().hasAudio) return;
    try {
      if (soundEnabled && !soundUnlocked) {
        await prepareAudio();
        playPreview();
      } else {
        soundEnabled = !soundEnabled;
        if (soundEnabled) await prepareAudio();
        if (monitorGain) monitorGain.gain.setTargetAtTime(soundEnabled ? 0.82 : 0, audioContext.currentTime, 0.018);
        previewVideo.muted = !soundEnabled;
      }
      updateSoundButton();
      showActionMessage(soundEnabled ? "Sound on" : "Sound off");
    } catch (error) {
      console.error(error);
      showActionMessage("Tap again for sound");
    }
  }

  async function startPreviewMuted() {
    previewVideo.muted = true;
    await previewVideo.play().catch(() => {});
  }

  function drawFrame(elapsedSeconds, message, canvas = exportCanvas, context = exportContext, slideEasing = 0.16) {
    const width = canvas.width;
    const height = canvas.height;
    const appearance = exportAppearance || getAppearance();
    const layout = layoutText(context, message, width, height, appearance);
    const { lines, size, lineHeight } = layout;
    const placement = placeText(layout, width, height, appearance.position, "right", appearance.alignment);
    const startY = placement.y + layout.baseline;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const activeVideo = rendering ? exportVideo : previewVideo;
    const videoEnd = activeVideo.duration || 0;
    const sourceFrame = cleanEndFrame && activeVideo.currentTime >= videoEnd - 0.04
      ? cleanEndFrame
      : activeVideo;
    const opaqueSource = Boolean(getStamp().opaqueSource && new URL(activeVideo.currentSrc).pathname === getStamp().opaqueSource);
    const drawSource = () => {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const fit = Math.min(width / activeVideo.videoWidth, height / activeVideo.videoHeight) * getStamp().scale;
      const drawWidth = activeVideo.videoWidth * fit;
      const drawHeight = activeVideo.videoHeight * fit;
      const bottomLeft = getStamp().anchor === "bottom-left";
      const x = bottomLeft ? 0 : (width - drawWidth) / 2;
      const y = bottomLeft ? height - drawHeight : (height - drawHeight) / 2;
      context.drawImage(sourceFrame, x, y, drawWidth, drawHeight);
    };
    if (opaqueSource) drawSource();
    context.textBaseline = "alphabetic";
    context.font = `700 ${size}px ${layout.font}`;
    context.fillStyle = "#171714";

    if (!appearance.position) {
      const desiredSlide = sideOppositeCharacter() === "left" ? 1 : 0;
      exportSlide += (desiredSlide - exportSlide) * slideEasing;
    }
    context.textAlign = "left";
    const right = placeText(layout, width, height, null, "right");
    const left = placeText(layout, width, height, null, "left");
    const rightAlign = appearance.alignment === "auto" ? "right" : appearance.alignment;
    const leftAlign = appearance.alignment === "auto" ? "left" : appearance.alignment;

    lines.forEach((_, index) => {
      const delay = index * 0.1;
      const entryProgress = Math.max(0, Math.min(1, (elapsedSeconds - delay) / 0.55));
      const entryEase = 1 - Math.pow(1 - entryProgress, 3);
      const rightX = right.x + textLineX(layout, index, rightAlign);
      const leftX = left.x + textLineX(layout, index, leftAlign);
      const lineX = appearance.position
        ? placement.x + textLineX(layout, index, placement.align)
        : rightX + (leftX - rightX) * exportSlide + (1 - entryEase) * width * 0.035;
      context.globalAlpha = entryEase;
      textRuns(layout, index, appearance.alignment).forEach((run) => {
        context.fillText(run.text, lineX + run.x, startY + index * lineHeight);
      });
    });

    context.globalAlpha = 1;
    context.textAlign = "left";
    if (!opaqueSource) drawSource();
  }

  function seekVideo(time, video = previewVideo) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.001) {
        resolve();
        return;
      }
      video.addEventListener("seeked", resolve, { once: true });
      video.currentTime = time;
    });
  }

  function renderedFile() {
    return renderedBlob ? new File([renderedBlob], renderedFilename, { type: renderedBlob.type }) : null;
  }

  function canShareRenderedVideo() {
    if (!mobileSaveNeedsTap() || !navigator.share || !navigator.canShare || !renderedBlob || exportVersion !== getMessageVersion()) return false;
    try {
      return navigator.canShare({ files: [renderedFile()] });
    } catch {
      return false;
    }
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
    if (!("requestVideoFrameCallback" in previewVideo)) return;
    previewVideo.requestVideoFrameCallback(() => {
      if (!rendering) syncTextToCharacter();
      monitorCleanPlayback();
    });
  }

  function setBusy(isBusy) {
    rendering = isBusy;
    if (isBusy) exportAppearance = normalizeAppearance(getAppearance());
    onBusyChanged(isBusy);
    stampButtons.forEach((button) => { button.disabled = isBusy; });
    if (isBusy) previewVideo.pause();
    status.classList.toggle("is-busy", isBusy);
    status.classList.remove("is-error");
    status.textContent = isBusy ? "Loading video for export" : "Ready";
  }

  async function prepareExportCanvas(longEdge) {
    await loadTextFont(exportAppearance.fontId);
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
    exportCanvas.width = Math.max(2, Math.round(longEdge / 2) * 2);
    exportCanvas.height = Math.max(2, Math.round(longEdge / FRAME_ASPECT_RATIO / 2) * 2);
    exportSlide = 0;

    exportVideo.loop = false;
    exportVideo.pause();
    await seekVideo(Math.max(0, duration - 0.08), exportVideo);
    cleanEndFrame = document.createElement("canvas");
    cleanEndFrame.width = sourceWidth;
    cleanEndFrame.height = sourceHeight;
    cleanEndFrame.getContext("2d", { alpha: true }).drawImage(exportVideo, 0, 0, sourceWidth, sourceHeight);
    await seekVideo(VIDEO_START, exportVideo);
    setTextSide("right", false);
    return duration;
  }

  async function makeVideo(event) {
    event?.preventDefault();
    if (rendering) {
      showActionMessage("Video is already rendering");
      return;
    }

    if (!window.MediaRecorder || !exportCanvas.captureStream) {
      status.classList.add("is-error");
      status.textContent = "Video export is not supported in this browser.";
      showActionMessage("Video export is not supported in this browser.", 0);
      downloadPending = false;
      downloadLabel.textContent = "Download video";
      downloadButton.removeAttribute("aria-busy");
      showDownloadError("Video export is not supported in this browser. Try GIF instead.");
      return;
    }

    setBusy(true);
    downloadLabel.textContent = "Preparing video…";
    downloadButton.setAttribute("aria-busy", "true");
    showDownloadProgress("Preparing…");
    const renderVersion = getMessageVersion();
    const message = getMessage();
    let canvasStream;
    let combinedStream;
    let recorder;
    let animationFrame = 0;

    try {
      await prepareAudio();
      const mobile = mobileSaveNeedsTap();
      const duration = await prepareExportCanvas(mobile ? MOBILE_LONG_EDGE : DESKTOP_LONG_EDGE);

      canvasStream = exportCanvas.captureStream(30);
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
      ...(getStamp().hasAudio ? recorderAudioDestination.stream.getAudioTracks() : [])
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
        const elapsed = Math.max(0, exportVideo.currentTime - VIDEO_START);
        drawFrame(elapsed, message, exportCanvas, exportContext);
        const progress = Math.min(90, Math.floor(elapsed / duration * 10) * 10);
        if (progress !== lastProgress) {
          lastProgress = progress;
          status.textContent = `Rendering video ${progress}%`;
          showDownloadProgress(`Video ${progress}%`);
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
      showDownloadProgress("Finishing…");
      exportVideo.pause();
      cancelAnimationFrame(animationFrame);
      // Paint one known-clean frame and let the canvas stream flush it before
      // stopping. This removes the final-frame flash/overlay glitch.
      drawFrame(Math.max(VIDEO_START, duration - 0.01), message, exportCanvas, exportContext);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      recorder.stop();
      await completed;

      const blob = new Blob(chunks, { type: mimeType });
      await verifyRecording(blob, duration);
      renderedBlob = blob;
      renderedFilename = `${getStamp().filename}.${mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`;
      downloadButton.download = renderedFilename;
      exportVersion = renderVersion;
      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
      renderedUrl = URL.createObjectURL(blob);
      if (renderVersion === getMessageVersion()) {
        downloadButton.href = renderedUrl;
        downloadButton.classList.remove("is-disabled");
        downloadButton.setAttribute("aria-disabled", "false");
        shareButton.disabled = false;
        onExportChanged();
        status.textContent = mobile ? "Video ready. Tap Save video." : "Video ready";
        if (downloadPending) {
          downloadPending = false;
          renderPending = false;
          if (mobile) {
            downloadLabel.textContent = "Save video";
            downloadButton.removeAttribute("aria-busy");
            showDownloadReady("Save video", renderedUrl, renderedFilename);
            showActionMessage("Ready — tap Save video");
          } else {
            saveRenderedVideo();
          }
        } else {
          downloadLabel.textContent = "Save video";
          downloadButton.removeAttribute("aria-busy");
          showDownloadReady("Save video", renderedUrl, renderedFilename);
        }
      } else {
        renderedBlob = undefined;
        URL.revokeObjectURL(renderedUrl);
        renderedUrl = "";
        downloadButton.href = "#";
        onExportChanged();
        status.textContent = "Text changed—ready to export";
        renderPending = renderPending || downloadPending;
      }
      status.classList.remove("is-busy");
    } catch (error) {
      console.error(error);
      downloadPending = false;
      renderPending = false;
      downloadLabel.textContent = "Download video";
      downloadButton.removeAttribute("aria-busy");
      showDownloadError("Video export failed. Choose a format to try again.");
      showActionMessage("Video export failed. Try again.", 0);
      status.classList.remove("is-busy");
      status.classList.add("is-error");
      status.textContent = "Couldn’t render—try again";
    } finally {
      rendering = false;
      exportAppearance = undefined;
      onBusyChanged(false);
      stampButtons.forEach((button) => { button.disabled = false; });
      cancelAnimationFrame(animationFrame);
      if (recorder?.state === "recording") recorder.stop();
      canvasStream?.getTracks().forEach((track) => track.stop());
      combinedStream?.getVideoTracks().forEach((track) => track.stop());
      exportVideo.pause();
      exportVideo.currentTime = VIDEO_START;
      playPreview();
      if (renderPending) {
        renderPending = false;
        window.setTimeout(() => makeVideo(), 0);
      }
    }
  }

  async function makeGif() {
    if (rendering) {
      showActionMessage("An export is already rendering");
      return;
    }

    setBusy(true);
    gifDownloadLabel.textContent = "Preparing GIF…";
    gifDownloadButton.setAttribute("aria-busy", "true");
    showDownloadProgress("Preparing…");
    const renderVersion = getMessageVersion();
    const message = getMessage();

    try {
      const { GIFEncoder, quantize, applyPalette } = await import("./vendor/gifenc.esm.js");
      const duration = await prepareExportCanvas(GIF_LONG_EDGE);
      const frameCount = Math.max(1, Math.ceil(duration * GIF_FPS));
      const gif = GIFEncoder();

      for (let frame = 0; frame < frameCount; frame += 1) {
        const time = Math.min(Math.max(0, duration - 0.04), frame / GIF_FPS);
        await seekVideo(time, exportVideo);
        drawFrame(time, message, exportCanvas, exportContext, 0.4);
        const pixels = exportContext.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data;
        const palette = quantize(pixels, 256);
        const indexed = applyPalette(pixels, palette);
        gif.writeFrame(indexed, exportCanvas.width, exportCanvas.height, {
          palette,
          delay: 1000 / GIF_FPS,
          repeat: 0
        });
        if (frame % GIF_FPS === 0) {
          const progress = Math.round(frame / frameCount * 100);
          status.textContent = `Rendering GIF ${progress}%`;
          gifDownloadLabel.textContent = `GIF ${progress}%`;
          showDownloadProgress(`GIF ${progress}%`);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }

      showDownloadProgress("Finishing…");
      gif.finish();
      const bytes = gif.bytes();
      if (bytes.length < 100) throw new Error("GIF export is empty");
      const blob = new Blob([bytes], { type: "image/gif" });
      if (renderVersion === getMessageVersion()) {
        if (renderedGifUrl) URL.revokeObjectURL(renderedGifUrl);
        renderedGifBlob = blob;
        renderedGifUrl = URL.createObjectURL(blob);
        gifVersion = renderVersion;
        gifDownloadButton.href = renderedGifUrl;
        gifDownloadLabel.textContent = mobileSaveNeedsTap() ? "Save GIF" : "GIF";
        status.textContent = mobileSaveNeedsTap() ? "GIF ready. Tap Save GIF." : "GIF ready";
        gifDownloadButton.removeAttribute("aria-busy");
        if (gifDownloadPending) {
          gifDownloadPending = false;
          if (mobileSaveNeedsTap()) {
            showDownloadReady("Save GIF", renderedGifUrl, gifDownloadButton.download);
            showActionMessage("Ready — tap Save GIF");
          } else saveRenderedFile(renderedGifUrl, gifDownloadButton.download);
        } else {
          showDownloadReady("Save GIF", renderedGifUrl, gifDownloadButton.download);
        }
      } else {
        gifDownloadPending = false;
        gifDownloadLabel.textContent = "Download GIF";
        gifDownloadButton.removeAttribute("aria-busy");
        status.textContent = "Text changed — ready to export";
        resetDownloadState();
      }
      status.classList.remove("is-busy");
    } catch (error) {
      console.error(error);
      gifDownloadPending = false;
      gifDownloadLabel.textContent = "Download GIF";
      gifDownloadButton.removeAttribute("aria-busy");
      showDownloadError("GIF export failed. Choose a format to try again.");
      showActionMessage("GIF export failed. Try again.", 0);
      status.classList.remove("is-busy");
      status.classList.add("is-error");
      status.textContent = "Couldn’t render GIF — try again";
    } finally {
      rendering = false;
      exportAppearance = undefined;
      onBusyChanged(false);
      stampButtons.forEach((button) => { button.disabled = false; });
      exportVideo.pause();
      exportVideo.currentTime = VIDEO_START;
      playPreview();
    }
  }

  function downloadVideo(event) {
    if (!downloads.accepted) {
      event.preventDefault();
      resetDownloadState();
      openDownloadDialog();
      return;
    }
    if (isTwitterInAppBrowser()) {
      event.preventDefault();
      showSwitchBrowserMessage();
      return;
    }
    if (rendering) {
      event.preventDefault();
      showActionMessage("Video is already rendering");
      return;
    }
    if (!renderedBlob || exportVersion !== getMessageVersion()) {
      event.preventDefault();
      downloadPending = true;
      downloadLabel.textContent = "Preparing video";
      downloadButton.setAttribute("aria-busy", "true");
      showDownloadProgress("Preparing…");
      makeVideo();
      return;
    }

    // Keep the browser's native anchor action inside this tap. Mobile browsers
    // may ignore a synthetic click made after an asynchronous render.
    status.textContent = "Download requested";
    showActionMessage("Download requested. Check your browser's downloads.");
    window.setTimeout(() => showDownloadSaving("Save video", renderedUrl, renderedFilename), 0);
  }

  function saveRenderedVideo() {
    saveRenderedFile(renderedUrl, renderedFilename);
  }

  function downloadGif(event) {
    if (!downloads.accepted) {
      event.preventDefault();
      resetDownloadState();
      openDownloadDialog();
      return;
    }
    if (isTwitterInAppBrowser()) {
      event.preventDefault();
      showSwitchBrowserMessage();
      return;
    }
    if (rendering) {
      event.preventDefault();
      showActionMessage("An export is already rendering");
      return;
    }
    if (!renderedGifBlob || gifVersion !== getMessageVersion()) {
      event.preventDefault();
      gifDownloadPending = true;
      makeGif();
      return;
    }
    status.textContent = "Download requested";
    showActionMessage("Download requested. Check your browser's downloads.");
    window.setTimeout(() => showDownloadSaving("Save GIF", renderedGifUrl, gifDownloadButton.download), 0);
  }

  function saveRenderedFile(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    showDownloadSaving(filename.endsWith(".gif") ? "Save GIF" : "Save video", url, filename);
    status.textContent = "Download requested";
    showActionMessage("Download requested. Check your browser's downloads.");
  }

  function isTwitterInAppBrowser() {
    return /Twitter/i.test(navigator.userAgent);
  }

  function showSwitchBrowserMessage() {
    const message = "X may block downloads here. Open this page in Safari or Chrome to save your file.";
    showDownloadError(message);
    status.textContent = message;
    showActionMessage(message, 0);
  }
  function invalidate() {
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    if (renderedGifUrl) URL.revokeObjectURL(renderedGifUrl);
    renderedUrl = renderedGifUrl = "";
    renderedBlob = renderedGifBlob = undefined;
    downloadButton.href = gifDownloadButton.href = "#";
    downloadLabel.textContent = "Download video";
    gifDownloadLabel.textContent = "Download GIF";
  }
  function resetSource() {
    cleanEndFrame = undefined;
    gifDownloadButton.download = `${getStamp().filename}.gif`;
    if (!getStamp().hasAudio) {
      soundEnabled = false;
      soundUnlocked = false;
      previewVideo.muted = true;
      exportVideo.muted = true;
      if (monitorGain) monitorGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.018);
    }
    updateSoundButton();
  }
  function resumeAfterEditing() {
    editingText = false;
    window.setTimeout(playPreview, 0);
  }

  // If audible playback is requested, unlock it on the next gesture.
  // The speaker button handles its own gesture.
  const unlockAudio = (event) => {
    if (event.target.closest?.("#sound-button, #text-overlay") || !soundEnabled || soundUnlocked) return;
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
    if (!event.target.closest(".stage-controls, #text-overlay")) togglePlayback();
  });

  previewVideo.addEventListener("play", updatePlayButton);
  previewVideo.addEventListener("pause", updatePlayButton);
  downloadButton.addEventListener("click", downloadVideo);
  gifDownloadButton.addEventListener("click", downloadGif);
  return {
    get rendering() { return rendering; },
    invalidate, resetSource, playPreview, pauseWhileEditing, resumeAfterEditing, beginTextGesture,
    updatePlayButton, updateSoundButton, startPreviewMuted, monitorCleanPlayback,
    renderedFile, canShareRenderedVideo
  };
}
