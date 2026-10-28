import { describe, expect, it } from 'vitest';
import {
  cssHex,
  formatFields,
  hexToHsva,
  hsvaToHex,
  normalizeHex,
  parseField,
} from './color';

describe('color', () => {
  it('normalizes typed hex', () => {
    expect(normalizeHex('#abc')).toBe('AABBCC');
    expect(normalizeHex('ff000080')).toBe('FF000080');
    expect(normalizeHex('ff00')).toBeUndefined();
    expect(normalizeHex('zzzzzz')).toBeUndefined();
  });

  it('round-trips hex through HSB', () => {
    for (const hex of ['FF0000', '00FF00', '0000FF', '7F3FBF', 'FFFFFF']) {
      expect(hsvaToHex(hexToHsva(hex))).toBe(hex);
    }
    expect(hsvaToHex(hexToHsva('12345680'))).toBe('12345680');
    expect(hexToHsva('FF0000')).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(hexToHsva('00FFFF').h).toBe(180);
  });

  it('formats the value fields', () => {
    const c = hexToHsva('FF8000');
    expect(formatFields(c, 'hex')).toEqual(['FF8000']);
    expect(formatFields(c, 'rgb')).toEqual(['255', '128', '0']);
    expect(formatFields(c, 'hsl')).toEqual(['30', '100', '50']);
    expect(formatFields(c, 'hsb')).toEqual(['30', '100', '100']);
    // The hex field leaves alpha to the opacity field.
    expect(formatFields(hexToHsva('FF800080'), 'hex')).toEqual(['FF8000']);
  });

  it('parses typed fields, keeping alpha', () => {
    const c = hexToHsva('FF000080');
    expect(hsvaToHex(parseField(c, 'hex', 0, '#00f') ?? c)).toBe('0000FF80');
    expect(hsvaToHex(parseField(c, 'hex', 0, '00FF0040') ?? c)).toBe(
      '00FF0040'
    );
    expect(hsvaToHex(parseField(c, 'rgb', 1, '255') ?? c)).toBe('FFFF0080');
    expect(hsvaToHex(parseField(c, 'hsb', 0, '240°') ?? c)).toBe('0000FF80');
    expect(hsvaToHex(parseField(c, 'hsl', 2, '100%') ?? c)).toBe('FFFFFF80');
    expect(parseField(c, 'rgb', 0, 'abc')).toBeUndefined();
    expect(parseField(c, 'hex', 0, 'nope')).toBeUndefined();
  });

  it('keeps the hue when a channel edit makes a gray', () => {
    const c = hexToHsva('FF0000');
    const gray = parseField(c, 'rgb', 1, '255');
    expect(gray?.h).toBe(60);
    const black = parseField({ h: 200, s: 0, v: 0, a: 1 }, 'rgb', 0, '0');
    expect(black?.h).toBe(200);
  });

  it('writes CSS with alpha', () => {
    expect(cssHex('FF000080')).toBe('rgba(255, 0, 0, 0.502)');
    expect(cssHex('00FF00')).toBe('rgba(0, 255, 0, 1)');
  });
});
