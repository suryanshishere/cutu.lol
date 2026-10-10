// Browser and server share the same templates and URL contract.
export const DEFAULT_STAMP = "baby-boo";
export const MAX_TEXT_LENGTH = 120;
export const CARD_VERSION = "2";
export const FRAME_ASPECT_RATIO = 16 / 9;
export const SITE_TITLE = "Personalized Meme Maker | cutu";
export const SITE_DESCRIPTION = "Create personalized memes with your own text. Choose Baby Boo or Speed, preview your animated meme, then download a video or GIF or share a personalized link for free.";

export const MEMES = Object.freeze({
  "baby-boo": {
    id: "baby-boo", name: "Baby Boo", image: "/baby-boo-stamp.png", shareImage: "/share-stamp.png",
    filename: "hamster-type", scale: 1.08, anchor: "center", hasAudio: true, opaqueSource: "/hamster-fallback.mp4",
    defaultText: "Small steps. Big wheel energy.",
    description: "Add your text to Baby Boo, then download or share your animated hamster meme for free.",
    preview: [["/hamster-preview.webm", 'video/webm; codecs="vp9, opus"'], ["/hamster-fallback.mp4", "video/mp4"]],
    export: [["/hamster-export.webm", 'video/webm; codecs="vp9, opus"'], ["/hamster-fallback.mp4", "video/mp4"]]
  },
  speed: {
    id: "speed", name: "Speed", image: "/speed-stamp.png?v=2", shareImage: "/speed-stamp.png",
    filename: "speed-type", scale: 0.7, anchor: "bottom-left", hasAudio: false, opaqueSource: null,
    defaultText: "Your text. Full speed.",
    description: "Add your text behind Speed, then download or share your animated meme for free.",
    preview: [["/speed.webm", "video/webm"]], export: [["/speed.webm", "video/webm"]]
  }
});

export function getMeme(id) {
  return MEMES[Object.hasOwn(MEMES, id) ? id : DEFAULT_STAMP];
}

export function normalizeText(value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\t/g, " ").trim();
  // Match textarea's UTF-16 limit without leaving half of an emoji at the end.
  return text.slice(0, MAX_TEXT_LENGTH).replace(/[\uD800-\uDBFF]$/, "").trimEnd();
}

export function readMemeUrl(url) {
  const meme = getMeme(url.searchParams.get("stamp"));
  const text = normalizeText(url.searchParams.get("text"));
  return { meme, text, message: text || meme.defaultText };
}

export function createShareUrl(origin, stamp, value) {
  const url = new URL("/", origin);
  const meme = getMeme(stamp);
  const text = normalizeText(value);
  if (text) url.searchParams.set("text", text);
  if (meme.id !== DEFAULT_STAMP) url.searchParams.set("stamp", meme.id);
  return url;
}

export function createCardUrl(origin, stamp, value) {
  const url = createShareUrl(origin, stamp, value);
  url.pathname = "/share-card.png";
  url.searchParams.set("v", CARD_VERSION);
  return url;
}
