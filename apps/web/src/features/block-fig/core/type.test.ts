import { describe, expect, it } from 'vitest';
import {
  cssLineHeight,
  formatLetterSpacing,
  formatLineHeight,
  parseLetterSpacing,
  parseLineHeight,
  parseStyle,
  styleName,
} from './type';

describe('type settings', () => {
  it('maps Figma style names to weights and back', () => {
    expect(parseStyle('Semi Bold Italic')).toEqual({
      weight: 600,
      italic: true,
    });
    expect(parseStyle('ExtraLight')).toEqual({ weight: 200, italic: false });
    expect(parseStyle(null)).toEqual({ weight: 400, italic: false });
    expect(styleName(700, false)).toBe('Bold');
    expect(styleName(400, true)).toBe('Italic');
    expect(styleName(600, true)).toBe('Semi Bold Italic');
    expect(styleName(650, false)).toBe('Semi Bold');
  });

  it('shows and parses line heights in Figma’s units', () => {
    expect(formatLineHeight([100, 'PERCENT'])).toBe('Auto');
    expect(formatLineHeight([1.5, 'RAW'])).toBe('150%');
    expect(formatLineHeight([24, 'PIXELS'])).toBe('24');
    expect(formatLineHeight(null)).toBe('Auto');
    expect(parseLineHeight('auto')).toEqual({ value: 0, unit: 'AUTO' });
    expect(parseLineHeight('150%')).toEqual({ value: 150, unit: 'PERCENT' });
    expect(parseLineHeight('20+4')).toEqual({ value: 24, unit: 'PIXELS' });
    expect(parseLineHeight('x')).toBeNull();
  });

  it('shows and parses letter spacing', () => {
    expect(formatLetterSpacing(null)).toBe('0%');
    expect(formatLetterSpacing([-2, 'PERCENT'])).toBe('-2%');
    expect(formatLetterSpacing([1.5, 'PIXELS'])).toBe('1.5');
    expect(parseLetterSpacing('-2%')).toEqual({ value: -2, unit: 'PERCENT' });
    expect(parseLetterSpacing('1px')).toEqual({ value: 1, unit: 'PIXELS' });
    expect(parseLetterSpacing('')).toEqual({ value: 0, unit: 'PIXELS' });
  });

  it('gives overlays a CSS line height', () => {
    expect(cssLineHeight([20, 'PIXELS'], 2)).toBe('40px');
    expect(cssLineHeight([1.5, 'RAW'], 2)).toBe('1.5');
    expect(cssLineHeight([100, 'PERCENT'], 2)).toBe('normal');
  });
});
