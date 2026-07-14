import { describe, expect, it } from 'vitest';
import {
  findClosestContrastingColor,
  normalizeRGBA,
  parseRGBA,
  rgbaToOklch,
  stripContentBackgrounds,
} from '../transform-email-colors';

describe('parseRGBA', () => {
  it('parses rgb() format', () => {
    const result = parseRGBA('rgb(255, 128, 64)');
    expect(result).toEqual({ r: 255, g: 128, b: 64, a: 1 });
  });

  it('parses rgba() format with alpha', () => {
    const result = parseRGBA('rgba(255, 128, 64, 0.5)');
    expect(result).toEqual({ r: 255, g: 128, b: 64, a: 0.5 });
  });

  it('parses rgba() format with space syntax', () => {
    const result = parseRGBA('rgba(255 128 64 / 0.5)');
    expect(result).toEqual({ r: 255, g: 128, b: 64, a: 0.5 });
  });

  it('handles transparent', () => {
    const result = parseRGBA('transparent');
    expect(result).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('returns null for invalid format', () => {
    const result = parseRGBA('invalid');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseRGBA('');
    expect(result).toBeNull();
  });
});

describe('normalizeRGBA', () => {
  it('normalizes 0-255 values to 0-1 range', () => {
    const result = normalizeRGBA({ r: 255, g: 128, b: 0, a: 0.5 });
    expect(result).toEqual({ r: 1, g: 128 / 255, b: 0, a: 0.5 });
  });

  it('clamps values to 0-1 range', () => {
    const result = normalizeRGBA({ r: 300, g: -10, b: 255, a: 1 });
    expect(result?.r).toBe(1);
    expect(result?.g).toBe(0);
    expect(result?.b).toBe(1);
  });

  it('returns null for null input', () => {
    const result = normalizeRGBA(null);
    expect(result).toBeNull();
  });
});

describe('rgbaToOklch', () => {
  it('converts black to OKLCH', () => {
    const result = rgbaToOklch({ r: 0, g: 0, b: 0, a: 1 });
    expect(result?.l).toBeCloseTo(0, 2);
    expect(result?.c).toBeCloseTo(0, 2);
  });

  it('converts white to OKLCH', () => {
    const result = rgbaToOklch({ r: 1, g: 1, b: 1, a: 1 });
    expect(result?.l).toBeCloseTo(1, 2);
    expect(result?.c).toBeCloseTo(0, 2);
  });

  it('preserves alpha value', () => {
    const result = rgbaToOklch({ r: 0.5, g: 0.5, b: 0.5, a: 0.75 });
    expect(result?.a).toBe(0.75);
  });

  it('converts red to OKLCH with correct hue range', () => {
    const result = rgbaToOklch({ r: 1, g: 0, b: 0, a: 1 });
    expect(result?.l).toBeGreaterThan(0);
    expect(result?.c).toBeGreaterThan(0);
    expect(result?.h).toBeGreaterThanOrEqual(0);
    expect(result?.h).toBeLessThan(360);
  });

  it('returns null for null input', () => {
    const result = rgbaToOklch(null);
    expect(result).toBeNull();
  });
});

describe('stripContentBackgrounds', () => {
  function render(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  function bg(el: Element | null) {
    return (el as HTMLElement).style.backgroundColor;
  }

  it('strips light page-like backgrounds', () => {
    const root = render(
      '<div id="page" style="background-color:#ffffff">text</div>'
    );
    stripContentBackgrounds(root);
    expect(bg(root.querySelector('#page'))).toBe('transparent');
    root.remove();
  });

  it('keeps dark/colored backgrounds', () => {
    const root = render(
      '<a id="btn" style="background-color:#7e82c9;color:#ffffff">button</a>'
    );
    stripContentBackgrounds(root);
    expect(bg(root.querySelector('#btn'))).toBe('rgb(126, 130, 201)');
    root.remove();
  });

  it('keeps a light background layered on a kept colored ancestor (1px-border button trick)', () => {
    // Outer div is a colored "border", inner anchor is the light button face
    // with text color matching the border. Stripping the face would leave
    // same-on-same invisible text.
    const root = render(
      '<div id="border" style="background-color:#51b1e7;padding:1px">' +
        '<a id="face" style="background-color:#e4ecf2;color:#51b1e7">Very disappointed</a>' +
        '</div>'
    );
    stripContentBackgrounds(root);
    expect(bg(root.querySelector('#border'))).toBe('rgb(81, 177, 231)');
    expect(bg(root.querySelector('#face'))).toBe('rgb(228, 236, 242)');
    root.remove();
  });

  it('strips nested light backgrounds once the ancestor light bg is stripped', () => {
    const root = render(
      '<div id="outer" style="background-color:#ffffff">' +
        '<div id="inner" style="background-color:#f2f2f2">text</div>' +
        '</div>'
    );
    stripContentBackgrounds(root);
    expect(bg(root.querySelector('#outer'))).toBe('transparent');
    expect(bg(root.querySelector('#inner'))).toBe('transparent');
    root.remove();
  });
});

describe('findClosestContrastingColor', () => {
  const CONTRAST_THRESHOLD = 0.5;

  it('increases lightness when fg is lighter than bg but contrast is low', () => {
    const fg = { l: 0.6, c: 0.1, h: 180 };
    const bgL = 0.5;
    const result = findClosestContrastingColor(fg, bgL);
    expect(Math.abs(result.l - bgL)).toBeGreaterThanOrEqual(
      CONTRAST_THRESHOLD - 0.01
    );
  });

  it('decreases lightness when fg is darker than bg but contrast is low', () => {
    const fg = { l: 0.4, c: 0.1, h: 180 };
    const bgL = 0.5;
    const result = findClosestContrastingColor(fg, bgL);
    expect(Math.abs(result.l - bgL)).toBeGreaterThanOrEqual(
      CONTRAST_THRESHOLD - 0.01
    );
  });

  it('preserves chroma and hue', () => {
    const fg = { l: 0.5, c: 0.15, h: 270, a: 0.8 };
    const bgL = 0.5;
    const result = findClosestContrastingColor(fg, bgL);
    expect(result.c).toBe(0.15);
    expect(result.h).toBe(270);
    expect(result.a).toBe(0.8);
  });

  it('handles edge case when candidate exceeds bounds', () => {
    const fg = { l: 0.9, c: 0.1, h: 180 };
    const bgL = 0.8;
    const result = findClosestContrastingColor(fg, bgL);
    expect(result.l).toBeGreaterThanOrEqual(0);
    expect(result.l).toBeLessThanOrEqual(1);
  });

  it('defaults alpha to 1 when not provided', () => {
    const fg = { l: 0.5, c: 0.1, h: 180 };
    const bgL = 0.5;
    const result = findClosestContrastingColor(fg, bgL);
    expect(result.a).toBe(1);
  });
});
