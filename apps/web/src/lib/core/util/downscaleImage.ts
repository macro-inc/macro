/**
 * Browser-side downscaling for images that are about to be uploaded.
 *
 * Phone cameras produce 12-48 megapixel photos that can weigh more than an
 * upload cap allows, and an avatar never needs that many pixels. Decoding
 * once, drawing onto a smaller canvas, and re-encoding keeps the upload small
 * without a server round trip.
 */

export type ImageDimensions = { width: number; height: number };

export type DownscaleImageOptions = {
  /** Longest edge, in pixels, the result may have. Smaller images are left alone. */
  maxEdge: number;
  /** Byte size the result should stay within. Larger images are re-encoded and shrunk. */
  maxBytes: number;
};

type EncodableType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Formats a canvas cannot re-encode faithfully: animation and vector data would be lost. */
const PASSTHROUGH_TYPES = new Set(['image/gif', 'image/svg+xml']);

/** Photo formats re-encode as JPEG; everything else stays lossless so transparency survives. */
const OUTPUT_TYPE: Record<string, EncodableType> = {
  'image/jpeg': 'image/jpeg',
  'image/heic': 'image/jpeg',
  'image/heif': 'image/jpeg',
  'image/webp': 'image/webp',
};

const EXTENSION: Record<EncodableType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ENCODE_QUALITY = 0.92;
/** Each retry after an over-budget encode shrinks the longest edge by this factor. */
const SHRINK_STEP = 0.75;
const MAX_ENCODE_ATTEMPTS = 5;

/** Scales `dimensions` down, never up, so neither edge exceeds `maxEdge`, keeping the aspect ratio. */
export function fitWithinEdge(
  dimensions: ImageDimensions,
  maxEdge: number
): ImageDimensions {
  const longest = Math.max(dimensions.width, dimensions.height);
  if (longest <= maxEdge) return dimensions;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

/** Whether an image of this byte size and pixel size needs downscaling before upload. */
export function exceedsUploadLimits(
  file: { size: number },
  dimensions: ImageDimensions,
  options: DownscaleImageOptions
): boolean {
  return (
    file.size > options.maxBytes ||
    dimensions.width > options.maxEdge ||
    dimensions.height > options.maxEdge
  );
}

/** Whether re-encoding this type through a canvas keeps what makes it that type. */
export function canDownscaleImageType(type: string): boolean {
  return type.startsWith('image/') && !PASSTHROUGH_TYPES.has(type);
}

function isEncodableType(type: string): type is EncodableType {
  return type in EXTENSION;
}

function replaceExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: EncodableType
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      type,
      ENCODE_QUALITY
    )
  );
}

function renderAt(
  bitmap: ImageBitmap,
  size: ImageDimensions,
  type: EncodableType
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return encodeCanvas(canvas, type);
}

/**
 * Returns `file` unchanged when it already fits within `options`, cannot be
 * decoded by this browser, or is a format that would lose data (GIF animation,
 * SVG vectors). Otherwise returns a new `File` scaled to fit `maxEdge` and
 * shrunk further while the encoded result is still over `maxBytes`.
 *
 * The result can still exceed `maxBytes` once shrinking runs out of attempts
 * or when the original is returned, so callers keep their own size check.
 */
export async function downscaleImageForUpload(
  file: File,
  options: DownscaleImageOptions
): Promise<File> {
  if (!canDownscaleImageType(file.type)) return file;
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    // Applies EXIF orientation while decoding, so the re-encoded pixels are upright.
    bitmap = await createImageBitmap(file);
  } catch {
    // Formats this browser cannot decode (HEIC outside Safari, corrupt files) upload as-is.
    return file;
  }

  try {
    const source = { width: bitmap.width, height: bitmap.height };
    if (!exceedsUploadLimits(file, source, options)) return file;

    const requestedType = OUTPUT_TYPE[file.type] ?? 'image/png';
    let size = fitWithinEdge(source, options.maxEdge);
    let blob = await renderAt(bitmap, size, requestedType);
    for (
      let attempt = 1;
      blob.size > options.maxBytes && attempt < MAX_ENCODE_ATTEMPTS;
      attempt++
    ) {
      const longest = Math.max(size.width, size.height);
      size = fitWithinEdge(size, Math.round(longest * SHRINK_STEP));
      blob = await renderAt(bitmap, size, requestedType);
    }

    // A browser without an encoder for the requested type (Safari and WebP)
    // silently produces PNG instead; name the file after what was produced.
    const outputType = isEncodableType(blob.type) ? blob.type : requestedType;
    return new File(
      [blob],
      replaceExtension(file.name, EXTENSION[outputType]),
      { type: outputType, lastModified: file.lastModified }
    );
  } catch (error) {
    console.warn('Failed to downscale image before upload', error);
    return file;
  } finally {
    bitmap.close();
  }
}
