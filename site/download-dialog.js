import { mobileSaveNeedsTap } from "./media.js";
import { DEFAULT_STAMP } from "./memes.js";

export function createDownloadDialog({ isRendering }) {
  const downloadToggle = document.querySelector("#download-toggle");
  const downloadDialog = document.querySelector("#download-dialog");
  const emailForm = document.querySelector("#download-email-form");
  const emailInput = document.querySelector("#download-email");
  const emailField = document.querySelector("#download-email-field");
  const emailError = document.querySelector("#download-email-error");
  const emailContinue = document.querySelector("#download-continue");
  const downloadFormats = document.querySelector("#download-formats");
  const downloadResult = document.querySelector("#download-result");
  const downloadResultMessage = document.querySelector("#download-result-message");
  const downloadProgress = document.querySelector("#download-progress");
  const downloadSave = document.querySelector("#download-save");
  const downloadAnother = document.querySelector("#download-another");
  const downloadButton = document.querySelector("#download-button");
  const downloadLabel = document.querySelector("#download-label");
  const gifDownloadButton = document.querySelector("#gif-download-button");
  const gifDownloadLabel = document.querySelector("#gif-download-label");
  const status = document.querySelector("#status");
  const EMAIL_INTAKE_KEY = "cutu-email-intake-complete";
  let emailAccepted = false;
  try { emailAccepted = localStorage.getItem(EMAIL_INTAKE_KEY) === "1"; } catch { /* Use page memory when storage is unavailable. */ }
  let emailSubmitting = false;
  let selectedTemplate = DEFAULT_STAMP;
  let downloadState = "choose";
  function setDownloadState(state, label, url = "", filename = "") {
    const previousState = downloadState;
    downloadState = state;
    emailForm.hidden = state !== "choose";
    emailField.hidden = emailAccepted;
    emailInput.required = !emailAccepted;
    downloadResult.hidden = state === "choose";
    downloadProgress.hidden = state !== "rendering";
    downloadSave.hidden = state !== "ready";
    downloadAnother.hidden = state !== "ready" && state !== "error";
    downloadResultMessage.textContent = label || "";
    downloadResultMessage.classList.toggle("download-error", state === "error");
    downloadResultMessage.classList.toggle("visually-hidden", state === "ready");
    downloadToggle.setAttribute("aria-busy", String(state === "rendering"));
    if (state === "rendering") {
      const percent = label.match(/(\d+)%/)?.[1];
      if (percent) downloadProgress.value = Number(percent);
      else if (label.startsWith("Finishing")) downloadProgress.value = 96;
      else downloadProgress.removeAttribute("value");
    }
    downloadSave.href = state === "ready" ? url : "#";
    if (state === "ready") {
      downloadSave.download = filename;
      downloadSave.textContent = filename.endsWith(".gif") ? "Save GIF" : "Save video";
    } else downloadSave.removeAttribute("download");
    if (downloadDialog.open && previousState !== state) {
      if (state === "ready") downloadSave.focus();
      else if (state === "choose") downloadFormats.querySelector("input:checked").focus();
      else downloadDialog.focus();
    }
  }

  function resetDownloadState() {
    setDownloadState("choose");
  }

  function showDownloadProgress(label) {
    setDownloadState("rendering", label);
  }

  function showDownloadReady(label, url, filename) {
    setDownloadState("ready", mobileSaveNeedsTap() ? `Ready — tap ${label}.` : "Your file is ready to save.", url, filename);
  }

  function showDownloadSaving(label, url, filename) {
    setDownloadState("ready", "Download requested. Check your browser’s downloads.", url, filename);
  }

  function showDownloadError(message) {
    setDownloadState("error", message);
  }

  function openDownloadDialog() {
    if (downloadDialog.open) return;
    // Use the visual viewport so the sheet stays above the mobile keyboard.
    updateDownloadViewport();
    downloadDialog.showModal();
    document.body.classList.add("download-dialog-open");
    if (downloadState === "choose" && emailAccepted) downloadFormats.querySelector("input:checked").focus();
    else downloadDialog.focus();
  }

  function updateDownloadViewport() {
    const viewport = window.visualViewport;
    downloadDialog.style.setProperty("--dialog-viewport-height", `${viewport?.height || window.innerHeight}px`);
    downloadDialog.style.setProperty("--dialog-viewport-top", `${viewport?.offsetTop || 0}px`);
  }

  async function submitDownloadEmail(event) {
    event.preventDefault();
    if (emailSubmitting || isRendering()) return;
    if (emailAccepted) {
      startSelectedDownload();
      return;
    }
    emailInput.value = emailInput.value.trim();
    emailError.hidden = true;
    emailInput.removeAttribute("aria-invalid");
    if (!emailInput.checkValidity()) {
      emailError.textContent = "Enter a valid email address, like you@example.com.";
      emailError.hidden = false;
      emailInput.setAttribute("aria-invalid", "true");
      emailInput.focus();
      return;
    }
    emailSubmitting = true;
    emailInput.readOnly = true;
    downloadFormats.disabled = true;
    emailContinue.disabled = true;
    emailContinue.textContent = "Saving…";
    emailForm.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/email-intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.value }), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        throw new Error(response.status === 400 ? "Enter a valid email address, like you@example.com." : "Couldn’t save your email. Please try again.");
      }
      emailAccepted = true;
      try { localStorage.setItem(EMAIL_INTAKE_KEY, "1"); } catch { /* Successful intake still unlocks this page. */ }
      emailInput.value = "";
      startSelectedDownload();
    } catch (error) {
      emailError.textContent = error.message.startsWith("Enter a valid") ? error.message : "Couldn’t save your email. Check your connection and try again.";
      emailError.hidden = false;
      if (error.message.startsWith("Enter a valid")) emailInput.setAttribute("aria-invalid", "true");
    } finally {
      emailSubmitting = false;
      emailInput.readOnly = false;
      downloadFormats.disabled = false;
      emailContinue.disabled = false;
      emailContinue.textContent = emailError.hidden ? "Continue to download" : "Try again";
      emailForm.removeAttribute("aria-busy");
    }
  }

  function startSelectedDownload() {
    const format = emailForm.elements.format.value;
    fetch("/api/download-event", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, template: selectedTemplate, id: crypto.randomUUID() }), keepalive: true
    }).catch(() => {});
    if (format === "gif") gifDownloadButton.click();
    else downloadButton.click();
  }

  downloadToggle.addEventListener("click", openDownloadDialog);
  emailForm.addEventListener("submit", submitDownloadEmail);
  emailInput.addEventListener("input", () => {
    emailInput.removeAttribute("aria-invalid");
    emailError.hidden = true;
    if (!emailSubmitting) emailContinue.textContent = "Continue to download";
  });
  document.querySelector("#download-close").addEventListener("click", () => downloadDialog.close());
  downloadDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...downloadDialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')]
      .filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !controls.includes(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
      event.preventDefault();
      first?.focus();
    }
  });
  let backdropPointerDown = false;
  downloadDialog.addEventListener("pointerdown", (event) => {
    const bounds = downloadDialog.getBoundingClientRect();
    backdropPointerDown = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  });
  downloadDialog.addEventListener("click", (event) => {
    const bounds = downloadDialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (backdropPointerDown && outside) downloadDialog.close();
    backdropPointerDown = false;
  });
  downloadDialog.addEventListener("close", () => {
    document.body.classList.remove("download-dialog-open");
    downloadToggle.focus({ preventScroll: true });
  });
  downloadAnother.addEventListener("click", () => {
    downloadLabel.textContent = "Download video";
    gifDownloadLabel.textContent = "Download GIF";
    resetDownloadState();
  });
  downloadSave.addEventListener("click", () => {
    status.textContent = "Download requested";
    downloadResultMessage.textContent = "Download requested. Check your browser’s downloads.";
  });
  window.visualViewport?.addEventListener("resize", updateDownloadViewport);
  window.visualViewport?.addEventListener("scroll", updateDownloadViewport);
  window.addEventListener("resize", updateDownloadViewport);
  return {
    setMeme(meme) {
      selectedTemplate = meme.id;
      const image = downloadDialog.querySelector(".download-stamp");
      image.src = meme.image;
      image.alt = meme.name;
      downloadDialog.setAttribute("aria-label", `Download ${meme.name}`);
    },
    get accepted() { return emailAccepted; },
    resetDownloadState, showDownloadProgress, showDownloadReady, showDownloadSaving,
    showDownloadError, openDownloadDialog
  };
}
