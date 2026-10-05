import { describe, expect, it } from 'vitest';
import { BLACK } from './color';
import {
  defaultTextStyle,
  fromPsText,
  pointText,
  postscriptName,
  realign,
  restyle,
  retext,
  toPsText,
} from './text';

const style = defaultTextStyle(BLACK);

describe('text layers', () => {
  it('converts paragraph ends', () => {
    expect(toPsText('a\nb')).toBe('a\rb\r');
    expect(fromPsText('a\rb\r')).toBe('a\nb');
    expect(toPsText('')).toBe('\r');
  });

  it('makes point text at a baseline', () => {
    const t = pointText('Hi\nthere', { x: 10.4, y: 20.6 }, style, 'center');
    expect(t.text).toBe('Hi\rthere\r');
    expect(t.runs).toEqual([{ length: 9, style }]);
    expect(t.paragraphs).toEqual([
      { length: 3, align: 'center' },
      { length: 6, align: 'center' },
    ]);
    expect(t.transform).toEqual([1, 0, 0, 1, 10, 21]);
    expect(t.area).toBeNull();
  });

  it('keeps style runs around an edit', () => {
    const bold = { ...style, fauxBold: true };
    const base = pointText('Hello world', { x: 0, y: 0 }, style);
    const layer = {
      ...base,
      runs: [
        { length: 6, style: bold },
        { length: 6, style },
      ],
    };
    // Typing at the end of the bold run continues it.
    const typed = retext(layer, 'Hello, world');
    expect(typed.runs).toEqual([
      { length: 7, style: bold },
      { length: 6, style },
    ]);
    // Deleting across both runs shortens each.
    const cut = retext(layer, 'Held');
    expect(cut.text).toBe('Held\r');
    expect(cut.runs.reduce((n, r) => n + r.length, 0)).toBe(5);
    expect(cut.runs[0]).toEqual({ length: 3, style: bold });
    // A new paragraph takes the alignment of the last one.
    const centered = realign(layer, 'center');
    const split = retext(centered, 'Hello\nworld');
    expect(split.paragraphs).toEqual([
      { length: 6, align: 'center' },
      { length: 6, align: 'center' },
    ]);
  });

  it('restyles every run', () => {
    const t = restyle(pointText('x', { x: 0, y: 0 }, style), { size: 48 });
    expect(t.runs[0].style.size).toBe(48);
  });

  it('spells PostScript names', () => {
    expect(postscriptName('Open Sans', 'Bold Italic')).toBe(
      'OpenSans-BoldItalic'
    );
    expect(postscriptName('Inter', 'Regular')).toBe('Inter-Regular');
  });
});
