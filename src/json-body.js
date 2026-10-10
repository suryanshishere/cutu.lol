// Keep request limits effective even when Content-Length is missing or wrong.
export async function readJsonBody(request, { maxBytes, emptyValue }) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { status: 415 };
  }
  if (Number(request.headers.get("Content-Length")) > maxBytes) return { status: 413 };

  try {
    const reader = request.body?.getReader();
    if (!reader) return emptyValue === undefined ? { status: 400 } : { value: emptyValue };
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) return { status: 413 };
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { status: 400 };
  }
}
