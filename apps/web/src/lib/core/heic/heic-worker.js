/** This worker will use native WebCodecs API (if available) with libheif-js fallback
 * to convert HEIC files to PNG for file upload */

const ERROR_MESSAGES = {
  NO_IMAGES_FOUND: 'No images found in HEIC file',
  PROCESSING_ERROR: 'HEIF processing error',
  WEBCODECS_DECODE_FAILED: 'WebCodecs decode failed',
};

let libheifModule;

// Lazy load libheif only when needed
async function getLibheifModule() {
  if (!libheifModule) {
    const libheif = await import('libheif-js/wasm-bundle');
    libheifModule = libheif.default || libheif;
  }
  return libheifModule;
}

self.onmessage = async (e) => {
  const {
    taskId,
    action,
    arrayBuffer,
    format = 'image/png',
    quality = 0.92,
    webCodecsSupportedMimeTypes,
    type: mimeType,
  } = e.data;

  if (action === 'convertHeic') {
    try {
      // Use WebCodecs support info passed from the worker pool
      if (
        webCodecsSupportedMimeTypes &&
        Array.isArray(webCodecsSupportedMimeTypes) &&
        webCodecsSupportedMimeTypes.includes(mimeType)
      ) {
        try {
          const dec = new ImageDecoder({ data: arrayBuffer, type: mimeType });
          const { image } = await dec.decode();
          const off = new OffscreenCanvas(image.codedWidth, image.codedHeight);
          const ctx = off.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const blob = await off.convertToBlob({ type: format, quality });
          const buf = await blob.arrayBuffer();

          self.postMessage(
            {
              taskId,
              type: 'complete',
              data: {
                arrayBuffer: buf,
                width: image.codedWidth,
                height: image.codedHeight,
                format,
              },
            },
            [buf]
          );
          return;
        } catch (webCodecsError) {
          console.warn(
            `${ERROR_MESSAGES.WEBCODECS_DECODE_FAILED} with ${mimeType}:`,
            webCodecsError.message
          );
        }
      }

      // Fallback to libheif - lazy load only when needed
      const libheif = await getLibheifModule();
      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(new Uint8Array(arrayBuffer));

      if (images.length === 0) {
        throw new Error(ERROR_MESSAGES.NO_IMAGES_FOUND);
      }

      // Use first image
      const img = images[0];
      const width = img.get_width();
      const height = img.get_height();

      // Create ImageData first, then let libheif fill it
      const off = new OffscreenCanvas(width, height);
      const ctx = off.getContext('2d', {
        willReadFrequently: false,
      });
      const imageData = ctx.createImageData(width, height);

      // Use the callback pattern from the libheif-js demo
      await new Promise((resolve, reject) => {
        img.display(imageData, (result) => {
          if (!result) {
            reject(new Error(ERROR_MESSAGES.PROCESSING_ERROR));
          } else {
            ctx.putImageData(imageData, 0, 0);
            resolve();
          }
        });
      });

      const blob = await off.convertToBlob({ type: format, quality });
      const buf = await blob.arrayBuffer();

      self.postMessage(
        {
          taskId,
          type: 'complete',
          data: { arrayBuffer: buf, width, height, format },
        },
        [buf]
      );
    } catch (error) {
      console.error('HEIC conversion error:', error);
      self.postMessage({
        taskId,
        type: 'error',
        data: { message: error.message || 'HEIC conversion failed' },
      });
    }
  }
};
