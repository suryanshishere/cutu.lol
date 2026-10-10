import { MEMES, SITE_TITLE, SITE_DESCRIPTION, createShareUrl, createCardUrl, readMemeUrl } from "../site/memes.js";

export function escapeMarkup(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function pageMetadata(url, origin = url.origin) {
  const { meme, text, message, appearance } = readMemeUrl(url);
  const personalized = Boolean(text || url.searchParams.has("stamp"));
  const title = personalized ? (text ? `A ${meme.name} message for you | cutu` : `${meme.name} Meme Maker | cutu`) : SITE_TITLE;
  const description = personalized ? text || meme.description : SITE_DESCRIPTION;
  const canonical = new URL("/", origin).href;
  const shareUrl = createShareUrl(origin, meme.id, text, appearance).href;
  const image = createCardUrl(origin, meme.id, text).href;
  const alt = `${meme.name} postage stamp with the message: ${message}`;
  const structuredData = {
    "@context": "https://schema.org", "@graph": [
      { "@type": "WebSite", "@id": `${canonical}#website`, name: "cutu", url: canonical },
      { "@type": "WebApplication", "@id": `${canonical}#app`, name: "cutu Personalized Meme Maker", url: canonical,
        description: SITE_DESCRIPTION, image, applicationCategory: "MultimediaApplication", operatingSystem: "Any",
        inLanguage: "en", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      { "@type": "WebPage", name: title, description, url: shareUrl, image,
        isPartOf: { "@id": `${canonical}#website` }, about: { "@id": `${canonical}#app` } }
    ]
  };
  return { title, description, canonical, shareUrl, image, alt, structuredData };
}

export function applyPageMeta(html, url, origin = url.origin) {
  const meta = pageMetadata(url, origin);
  const values = [
    ["name", "description", meta.description], ["property", "og:title", meta.title],
    ["property", "og:description", meta.description], ["property", "og:url", meta.shareUrl],
    ["property", "og:image", meta.image], ["property", "og:image:alt", meta.alt],
    ["name", "twitter:title", meta.title], ["name", "twitter:description", meta.description],
    ["name", "twitter:image", meta.image], ["name", "twitter:image:alt", meta.alt]
  ];
  html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>cutu</title>")
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, () => `<link rel="canonical" href="${escapeMarkup(meta.canonical)}" />`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () =>
      `<script type="application/ld+json">${JSON.stringify(meta.structuredData).replace(/</g, "\\u003c")}</script>`);
  for (const [kind, key, value] of values) {
    const pattern = new RegExp(`<meta ${kind}="${key.replaceAll(".", "\\.")}" content="[^"]*"\\s*\\/>`);
    html = html.replace(pattern, () => `<meta ${kind}="${key}" content="${escapeMarkup(value)}" />`);
  }
  const { meme, message, appearance } = readMemeUrl(url);
  const sources = (items) => items.map(([src, type]) => `<source src="${escapeMarkup(src)}" type="${escapeMarkup(type)}" />`).join("");
  const picker = Object.values(MEMES).map((item) => {
    const selected = item.id === meme.id;
    return `<button class="character-stamp${selected ? " is-selected" : ""}" data-stamp="${item.id}" type="button" aria-label="${item.name}" title="${item.name}" aria-pressed="${selected}"><img src="${escapeMarkup(item.image)}" alt="" /></button>`;
  }).join("\n");
  html = html.replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/, (_, start, end) => `${start}${escapeMarkup(message)}${end}`)
    .replace(/<label id="text-motion-option"([^>]*)>/, (_, attributes) => `<label id="text-motion-option"${attributes.replace(/\s+hidden(?:="")?/g, "")}${meme.hasTextMotion ? "" : " hidden"}>`)
    .replace(/<input id="text-motion"[^>]*\/>/, () => `<input id="text-motion" type="checkbox"${appearance.position ? "" : " checked"} />`)
    .replace(/<button id="sound-button"([^>]*)>/, (_, attributes) => `<button id="sound-button"${attributes.replace(/\s+hidden(?:="")?/g, "")}${meme.hasAudio ? "" : " hidden"}>`)
    .replace(/(<div class="stamp-picker"[^>]*>)[\s\S]*?(<\/div>)/, (_, start, end) => `${start}${picker}${end}`)
    .replace(/(<video\s+id="meme-video"[\s\S]*?>)[\s\S]*?(<\/video>)/, (_, start, end) => `${start}${sources(meme.preview)}${end}`)
    .replace(/(<video\s+id="export-video"[\s\S]*?>)[\s\S]*?(<\/video>)/, (_, start, end) => `${start}${sources(meme.export)}${end}`)
    .replace(/<div id="stage"[^>]*>/, () => `<div id="stage" class="stage" data-stamp="${meme.id}" aria-label="${meme.name} Video Preview" data-media-anchor="${meme.anchor}" data-has-audio="${meme.hasAudio}">`)
    .replace(/<img class="download-stamp"[^>]*\/>/, () => `<img class="download-stamp" src="${escapeMarkup(meme.image)}" alt="${meme.name}" />`);
  return html;
}
