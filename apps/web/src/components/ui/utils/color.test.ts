import { describe, expect, it } from 'vitest';
import {
  normalizePickerColor,
  parsePickerColor,
  pickerColorToHex,
  preservePickerHue,
} from './color';

describe('picker colors', () => {
  it.each([
    ['#f00', '#ff0000'],
    ['#F008', '#ff000088'],
    ['#FfAACC', '#ffaacc'],
    ['#ffaacc00', '#ffaacc00'],
    ['rgb(255, 128, 0)', '#ff8000'],
    ['rgba(255, 0, 0, .5)', '#ff000080'],
    ['rgb(100% 0% 50% / 25%)', '#ff008040'],
    ['transparent', '#00000000'],
    ['none', '#00000000'],
    ['rgb(300, -10, 20)', '#ff0014'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePickerColor(input)).toBe(expected);
  });

  it.each([
    '',
    '#12',
    '#abcde',
    '#1122334455',
    'rgb(1, 2)',
    'rgb(, 2, 3)',
    'rgba(1, 2, 3, nope)',
    'rgb(NaN 0 0)',
    'oklch(0.5 0.1 30)',
    'var(--color-ink)',
    'red',
  ])('rejects unsupported %s without throwing', (value) => {
    expect(normalizePickerColor(value)).toBeUndefined();
  });

  it('round trips RGB and alpha exactly through HSV', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = `#${[r, g, b, 128].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
          expect(pickerColorToHex(parsePickerColor(hex)!)).toBe(hex);
        }
      }
    }
  });

  it('preserves hue for gray and hue plus saturation for black', () => {
    const blue = parsePickerColor('#0000ff')!;
    expect(preservePickerHue(parsePickerColor('#888')!, blue)).toMatchObject({
      h: 240,
      s: 0,
    });
    expect(preservePickerHue(parsePickerColor('#000')!, blue)).toMatchObject({
      h: 240,
      s: 1,
      v: 0,
    });
  });
});
