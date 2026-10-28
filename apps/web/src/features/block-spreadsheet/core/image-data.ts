/** Raster image data as Macro stores it: a data URL under a content key. */

/** One image's data, at most. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** A content key: equal images share one stored copy. */
export function imageKey(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9747b28c ^ bytes.length;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x5bd1e995);
    second ^= second >>> 15;
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/** The image type browsers can display, from the data itself. */
export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  if (starts(0x42, 0x4d)) return 'bmp';
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * An image file as a stored image, or undefined when browsers cannot show
 * it or it is larger than `MAX_IMAGE_BYTES`.
 */
export function storedImage(
  bytes: Uint8Array
): { key: string; url: string } | undefined {
  const type = imageType(bytes);
  if (!type || bytes.length > MAX_IMAGE_BYTES) return;
  return {
    key: imageKey(bytes),
    url: `data:image/${type};base64,${base64(bytes)}`,
  };
}
