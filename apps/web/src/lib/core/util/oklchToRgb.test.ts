import { describe, expect, it } from 'vitest';
import { oklchToHex } from './oklchToRgb';

describe('oklchToHex', () => {
  it('converts neutral colors with a missing hue to visible hex colors', () => {
    expect(oklchToHex('oklch(97% 0 none)')).toBe('#f5f5f5');
    expect(oklchToHex('oklch(37.1% 0 none)')).toBe('#404040');
  });

  it('preserves numeric hue conversion', () => {
    expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(0% 0 0)')).toBe('#000000');
    expect(oklchToHex('oklch(50.5% 0.213 27.518)')).toBe('#c10007');
  });
});
