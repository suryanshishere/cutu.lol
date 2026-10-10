import { createShareUrl } from "./memes.js";
import { mobileSaveNeedsTap } from "./media.js";

export function createSharingController({ media, getStamp, getMessage, showActionMessage }) {
  const shareButton = document.querySelector("#share-button");
  const shareLabel = document.querySelector("#share-label");
  const shareIcon = document.querySelector("#share-icon");
  const status = document.querySelector("#status");
  let shareResetTimer;
  function updateShareLabel() {
    const label = media.canShareRenderedVideo() ? "Share Video" : navigator.share && mobileSaveNeedsTap() ? "Share Link" : "Copy Link";
    shareButton.setAttribute("aria-label", label);
    shareButton.title = label;
    setShareLabel(label);
  }

  function setShareLabel(label) {
    if (shareLabel.textContent === label) return;
    shareLabel.textContent = label;
  }

  async function shareVideo() {
    const shareUrl = createShareUrl(location.origin, getStamp().id, getMessage());
    const linkText = shareUrl.href;

    try {
      if (navigator.share && mobileSaveNeedsTap()) {
        try {
          const fileShare = media.canShareRenderedVideo();
          await navigator.share(fileShare
            ? { title: `${getStamp().name} video`, files: [media.renderedFile()] }
            : { title: `${getStamp().name} video`, url: linkText });
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
      setShareLabel("Copied");
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
  shareButton.addEventListener("click", shareVideo);
  return { updateShareLabel };
}
