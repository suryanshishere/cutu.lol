// Load the website's icon directly, without uploading or storing an image.
export function brandLogoUrl(link) {
  try {
    const url = new URL(link);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return new URL("/favicon.ico", url.origin).href;
  } catch { return ""; }
}
