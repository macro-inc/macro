import { describe, expect, it } from 'vitest';
import { recolorMascotPixels } from './mascot-image';

describe('mascot recoloring', () => {
  it('retains the original black and gives white mascots black eyes without changing transparency', () => {
    const black = new Uint8ClampedArray([
      0, 0, 0, 255, 64, 64, 64, 128, 255, 255, 255, 255, 0, 0, 0, 0,
    ]);
    const white = black.slice();
    recolorMascotPixels(black, '#000000');
    expect([...black]).toEqual([
      0, 0, 0, 255, 64, 64, 64, 128, 255, 255, 255, 255, 0, 0, 0, 0,
    ]);
    recolorMascotPixels(white, '#ffffff');
    expect([...white]).toEqual([
      210, 210, 210, 255, 221, 221, 221, 128, 0, 0, 0, 255, 210, 210, 210, 0,
    ]);
  });
  it('colors the body while preserving highlights, white eyes, background and alpha', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255, 244, 244, 244, 255, 0,
      0, 0, 0,
    ]);
    recolorMascotPixels(pixels, '#619ce8');
    expect([...pixels.slice(0, 4)]).toEqual([70, 112, 167, 255]);
    expect(pixels[4]).toBeGreaterThan(pixels[0]);
    expect(pixels[5]).toBeGreaterThan(pixels[1]);
    expect(pixels[6]).toBeGreaterThan(pixels[2]);
    expect([...pixels.slice(8, 16)]).toEqual([
      255, 255, 255, 255, 244, 244, 244, 255,
    ]);
    expect(pixels[19]).toBe(0);
  });
});
