import { describe, expect, it } from 'vitest';
import {
  formatLength,
  orientationOf,
  parseLength,
  presetOf,
  presetSize,
  sizeChange,
  unitForLocale,
} from './slide-size';

describe('slide size', () => {
  it('names the sizes PowerPoint names, in either orientation', () => {
    expect(presetOf(960, 540)).toBe('widescreen');
    expect(presetOf(720, 540)).toBe('screen4x3');
    expect(presetOf(540, 720)).toBe('screen4x3');
    expect(presetOf(780, 540)).toBe('a4');
    expect(presetOf(720, 405)).toBe('screen16x9');
    expect(presetOf(700, 500)).toBe('custom');
    expect(presetSize('a4', 'portrait')).toEqual({ width: 540, height: 780 });
    expect(presetSize('banner', 'landscape')).toEqual({
      width: 576,
      height: 72,
    });
    expect(orientationOf(540, 780)).toBe('portrait');
    expect(orientationOf(960, 540)).toBe('landscape');
  });

  it('asks Maximize or Ensure Fit only when the shape changes', () => {
    const wide = { width: 960, height: 540 };
    expect(sizeChange(wide, { width: 960, height: 540 })).toBe('same');
    expect(sizeChange(wide, { width: 720, height: 405 })).toBe('proportional');
    expect(sizeChange(wide, { width: 720, height: 540 })).toBe('reshape');
    expect(sizeChange(wide, { width: 540, height: 960 })).toBe('reshape');
  });

  it('measures in inches or centimeters by locale', () => {
    expect(unitForLocale('en-US')).toBe('in');
    expect(unitForLocale('en')).toBe('in');
    expect(unitForLocale('en-GB')).toBe('cm');
    expect(unitForLocale('de-DE')).toBe('cm');
    expect(formatLength(960, 'in')).toBe('13.333 in');
    expect(formatLength(540, 'in')).toBe('7.5 in');
    expect(formatLength(960, 'cm')).toBe('33.87 cm');
  });

  it('reads typed lengths in any unit', () => {
    expect(parseLength('10', 'in')).toBe(720);
    expect(parseLength('7.5 in', 'cm')).toBe(540);
    expect(parseLength('10"', 'cm')).toBe(720);
    expect(parseLength('2,54', 'cm')).toBeCloseTo(72);
    expect(parseLength('254 mm', 'in')).toBeCloseTo(720);
    expect(parseLength('wide', 'in')).toBeUndefined();
    expect(parseLength('', 'in')).toBeUndefined();
  });
});
