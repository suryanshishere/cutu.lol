export function createFrameCleaner() {
  const cleanFrameCanvas = document.createElement("canvas");
  const cleanFrameContext = cleanFrameCanvas.getContext("2d", { willReadFrequently: true });
  let cleanVisited = new Uint8Array(0);
  let cleanQueue = new Int32Array(0);
  function cleanVideoFrame(sourceFrame, width, height) {
    if (cleanFrameCanvas.width !== width || cleanFrameCanvas.height !== height) {
      cleanFrameCanvas.width = width;
      cleanFrameCanvas.height = height;
    }
    cleanFrameContext.clearRect(0, 0, width, height);
    cleanFrameContext.drawImage(sourceFrame, 0, 0, width, height);

    const image = cleanFrameContext.getImageData(0, 0, width, height);
    const pixels = image.data;
    const pixelCount = width * height;
    if (cleanVisited.length !== pixelCount) cleanVisited = new Uint8Array(pixelCount);
    if (cleanQueue.length !== pixelCount) cleanQueue = new Int32Array(pixelCount);
    cleanVisited.fill(0);
    const visited = cleanVisited;
    const queue = cleanQueue;
    let head = 0;
    let tail = 0;
    const isMatte = (index) => {
      const offset = index * 4;
      if (pixels[offset + 3] < 8) return true;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      return red > 238 && green > 238 && blue > 238 && Math.max(red, green, blue) - Math.min(red, green, blue) < 18;
    };
    const seed = (index) => {
      if (visited[index] || !isMatte(index)) return;
      visited[index] = 1;
      queue[tail++] = index;
    };
    for (let x = 0; x < width; x += 1) {
      seed(x);
      seed((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      seed(y * width);
      seed(y * width + width - 1);
    }
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      pixels[index * 4 + 3] = 0;
      if (x > 0) seed(index - 1);
      if (x + 1 < width) seed(index + 1);
      if (y > 0) seed(index - width);
      if (y + 1 < height) seed(index + width);
    }
    cleanFrameContext.putImageData(image, 0, 0);
    return cleanFrameCanvas;
  }

  return cleanVideoFrame;
}
