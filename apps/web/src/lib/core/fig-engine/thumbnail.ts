/**
 * The preview Figma stores in every `.fig` file, read without the engine so
 * a large design shows something while its workers are still decoding it.
 *
 * Current files are ZIP archives with a stored `thumbnail.png`; older ones
 * are the bare document, whose third chunk is the PNG.
 */

const PNG = [0x89, 0x50, 0x4e, 0x47];

function isPng(bytes: Uint8Array): boolean {
  return PNG.every((b, i) => bytes[i] === b);
}

function zipThumbnail(bytes: Uint8Array, view: DataView): Uint8Array | null {
  // The end of central directory record sits in the last 64 KiB + 22 bytes.
  const min = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= min; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count && at + 46 <= bytes.length; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name === 'thumbnail.png') {
      if (method !== 0 || local + 30 > bytes.length) return null;
      const start =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      const png = bytes.subarray(start, start + size);
      return png.length === size && isPng(png) ? png : null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function legacyThumbnail(bytes: Uint8Array, view: DataView): Uint8Array | null {
  // `fig-kiwi` (or another `fig-` magic), a version, then length-prefixed
  // chunks: schema, message, thumbnail.
  let at = 12;
  for (let chunk = 0; chunk < 3 && at + 4 <= bytes.length; chunk++) {
    const length = view.getUint32(at, true);
    const start = at + 4;
    if (start + length > bytes.length) return null;
    if (chunk === 2) {
      const png = bytes.subarray(start, start + length);
      return isPng(png) ? png : null;
    }
    at = start + length;
  }
  return null;
}

/** The PNG preview a `.fig` file carries, if it has one. */
export function figThumbnail(buffer: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22) return null;
  const view = new DataView(buffer);
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b)
      return zipThumbnail(bytes, view);
    if (startsWithFig(bytes)) return legacyThumbnail(bytes, view);
  } catch {
    // A damaged file has no preview; opening it reports the damage.
  }
  return null;
}

function startsWithFig(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x66 &&
    bytes[1] === 0x69 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x2d
  );
}
