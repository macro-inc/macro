import { crc32, deflateSync } from 'node:zlib';

/** An RGB raster, row-major, three bytes per pixel. */
export type Raster = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const checked = new Uint8Array(typeBytes.length + data.length);
  checked.set(typeBytes, 0);
  checked.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(checked));
  return out;
};

/**
 * Encodes an RGB raster as an 8-bit truecolor PNG with no ancillary chunks,
 * so the file carries pixels only: no text, time or other metadata. The
 * pixels are stored uncompressed: a compressed file's size depends on what
 * it shows (a big flat shape compresses well), which would give answers
 * away to anything that only sees file sizes. Stored, every image of one
 * size has the same byte length.
 */
export const encodePng = (raster: Raster): Uint8Array => {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, raster.width);
  headerView.setUint32(4, raster.height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor

  // Every scanline starts with filter type 0 (none).
  const rowBytes = raster.width * 3;
  const scanlines = new Uint8Array((rowBytes + 1) * raster.height);
  for (let row = 0; row < raster.height; row++) {
    scanlines.set(
      raster.pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
      row * (rowBytes + 1) + 1
    );
  }

  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 0 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
