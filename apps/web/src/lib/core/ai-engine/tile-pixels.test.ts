import { describe, expect, it } from 'vitest';
import { overColor } from './tile-pixels';

describe('overColor', () => {
  it('fills transparent pixels and keeps opaque ones', () => {
    const pixels = new Uint8Array([10, 20, 30, 255, 99, 99, 99, 0]);
    overColor(pixels, [200, 201, 202]);
    expect([...pixels]).toEqual([10, 20, 30, 255, 200, 201, 202, 255]);
  });

  it('blends partly transparent pixels with straight alpha', () => {
    const pixels = new Uint8Array([255, 0, 0, 128]);
    overColor(pixels, [0, 0, 255]);
    const k = 128 / 255;
    expect([...pixels]).toEqual([
      Math.round(255 * k),
      0,
      Math.round(255 * (1 - k)),
      255,
    ]);
  });
});
