import { describe, expect, it } from 'vitest';
import { buildImagePdf } from './pdf';
import {
  defaultPaper,
  pageSpec,
  paginate,
  parseSlideRange,
} from './print-layout';

describe('print layouts', () => {
  it('parses slide ranges like PowerPoint', () => {
    expect(parseSlideRange('1-3, 5', 8)).toEqual([0, 1, 2, 4]);
    expect(parseSlideRange('7-12', 8)).toEqual([6, 7]);
    expect(parseSlideRange('2,2', 8)).toEqual([1]);
    expect(parseSlideRange('3-1', 8)).toBeUndefined();
    expect(parseSlideRange('x', 8)).toBeUndefined();
    expect(parseSlideRange('9', 8)).toBeUndefined();
  });

  it('paginates handouts', () => {
    expect(paginate([0, 1, 2, 3, 4, 5, 6], 6)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [6],
    ]);
  });

  it('keeps every slide box on the page and in the slide aspect', () => {
    for (const layout of ['notes', 'handouts3', 'handouts6'] as const) {
      const spec = pageSpec(layout, 960, 540, 'letter');
      for (const r of spec.slides) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(spec.width);
        expect(r.y + r.h).toBeLessThanOrEqual(spec.height);
        expect(r.w / r.h).toBeCloseTo(960 / 540, 3);
      }
    }
    expect(pageSpec('slides', 720, 540, 'a4')).toMatchObject({
      width: 720,
      height: 540,
    });
  });

  it('picks paper by locale', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('de-DE')).toBe('a4');
  });
});

describe('image PDF', () => {
  it('writes a page per image with a valid cross-reference table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const page = {
      width: 960,
      height: 540,
      jpeg,
      pixelWidth: 2,
      pixelHeight: 1,
    };
    const bytes = buildImagePdf([page, page], 'Deck (draft)');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/Title (Deck \\(draft\\))');
    expect(text).toContain('/MediaBox [0 0 960 540]');
    // Every xref offset points at its object.
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    const rows = text
      .slice(xref)
      .split('\n')
      .slice(3, 3 + 9);
    rows.forEach((row, i) => {
      const at = Number(row.slice(0, 10));
      expect(text.slice(at, at + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });
});
