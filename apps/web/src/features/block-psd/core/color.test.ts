import { describe, expect, it } from 'vitest';
import {
  css,
  fromBytes,
  fromHsb,
  parseHex,
  sameColor,
  toBytes,
  toHex,
  toHsb,
} from './color';

describe('colors', () => {
  it('round-trips hex', () => {
    const c = parseHex('#3a7bd5');
    expect(c && toHex(c)).toBe('3A7BD5');
    expect(parseHex('fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHex('nope')).toBeUndefined();
    expect(parseHex('#12345')).toBeUndefined();
  });

  it('round-trips HSB', () => {
    for (const hex of ['FF0000', '00FF00', '0000FF', '808080', '3A7BD5', 'F5A623']) {
      const c = parseHex(hex);
      if (!c) throw new Error(hex);
      expect(toHex(fromHsb(toHsb(c)))).toBe(hex);
    }
    expect(toHsb(fromBytes(255, 0, 0))).toEqual({ h: 0, s: 1, b: 1 });
    expect(toHsb(fromBytes(0, 0, 0)).s).toBe(0);
  });

  it('formats CSS and compares at 8 bits', () => {
    expect(css(fromBytes(10, 20, 30))).toBe('rgb(10, 20, 30)');
    expect(css(fromBytes(10, 20, 30), 0.5)).toBe('rgba(10, 20, 30, 0.5)');
    expect(toBytes({ r: 1.2, g: -1, b: 0.5 })).toEqual([255, 0, 128]);
    expect(sameColor({ r: 0.5, g: 0.5, b: 0.5 }, { r: 0.501, g: 0.5, b: 0.5 })).toBe(true);
  });
});
