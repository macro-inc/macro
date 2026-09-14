import { describe, expect, it } from 'vitest';
import {
  findClosestContrastingColor,
  normalizeRGBA,
  parseRGBA,
  rgbaToOklch,
} from './colors';

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

  it('returns null for null input', () => {
    const result = rgbaToOklch(null);
    expect(result).toBeNull();
  });
});

describe('findClosestContrastingColor', () => {
  it.each([
    {
      name: 'lightens text above the background',
      lightness: 0.6,
      background: 0.5,
      expected: 1,
      alpha: 0.8,
    },
    {
      name: 'darkens text below the background',
      lightness: 0.4,
      background: 0.5,
      expected: 0,
      alpha: 0.8,
    },
    {
      name: 'switches to dark text when lightening would exceed white',
      lightness: 0.9,
      background: 0.8,
      expected: 0.3,
      alpha: 0.8,
    },
    {
      name: 'switches to light text when darkening would exceed black',
      lightness: 0.1,
      background: 0.2,
      expected: 0.7,
      alpha: undefined,
    },
  ])(
    '$name while preserving hue, chroma and opacity',
    ({ lightness, background, expected, alpha }) => {
      const result = findClosestContrastingColor(
        { l: lightness, c: 0.15, h: 270, a: alpha },
        background
      );
      expect(result.l).toBeCloseTo(expected);
      expect(result.c).toBe(0.15);
      expect(result.h).toBe(270);
      expect(result.a).toBe(alpha ?? 1);
    }
  );
});
