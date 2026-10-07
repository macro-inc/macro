/**
 * Tiles are drawn on the pasteboard color, so they are opaque: coarse
 * stand-ins under a sharper tile never show through its empty parts, and
 * the canvas can composite without alpha.
 */

/**
 * Composites straight RGBA pixels over an opaque color, in place, leaving
 * every pixel opaque. Returns the same array.
 */
export function overColor(
  pixels: Uint8Array | Uint8ClampedArray,
  [r, g, b]: readonly [number, number, number]
): Uint8Array | Uint8ClampedArray {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 255) continue;
    if (a === 0) {
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    } else {
      const k = a / 255;
      pixels[i] = Math.round(pixels[i] * k + r * (1 - k));
      pixels[i + 1] = Math.round(pixels[i + 1] * k + g * (1 - k));
      pixels[i + 2] = Math.round(pixels[i + 2] * k + b * (1 - k));
    }
    pixels[i + 3] = 255;
  }
  return pixels;
}
