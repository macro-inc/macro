import type { TextGeometry } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import {
  caretRect,
  hitIndex,
  lineEnds,
  lineIndexOf,
  paragraphAt,
  selectionRects,
  toLayer,
  verticalMove,
  wordAt,
} from './caret';

// "ab cd\nef": "ab " wraps, then "cd\n", then "ef"; 10 px per character.
const TEXT = 'ab cd\nef';
const g: TextGeometry = {
  transform: [1, 0, 0, 1, 100, 50],
  length: 8,
  lines: [
    { start: 0, end: 3, top: 0, height: 20, baseline: 15, xs: [0, 10, 20, 30] },
    {
      start: 3,
      end: 6,
      top: 20,
      height: 20,
      baseline: 35,
      xs: [0, 10, 20, 20],
    },
    { start: 6, end: 8, top: 40, height: 20, baseline: 55, xs: [0, 10, 20] },
  ],
};

describe('the caret', () => {
  it('stands before a character, the end of a wrapped line on the next', () => {
    expect(caretRect(g, 1)).toEqual({ x: 10, top: 0, height: 20 });
    expect(lineIndexOf(g, 3)).toBe(1);
    expect(caretRect(g, 3)).toEqual({ x: 0, top: 20, height: 20 });
    // Before the line break, after "cd".
    expect(caretRect(g, 5)).toEqual({ x: 20, top: 20, height: 20 });
    expect(caretRect(g, 8)).toEqual({ x: 20, top: 40, height: 20 });
  });

  it('lands on the nearest character for a point', () => {
    expect(hitIndex(g, 14, 5)).toBe(1);
    expect(hitIndex(g, 16, 5)).toBe(2);
    expect(hitIndex(g, 500, 25)).toBe(5);
    expect(hitIndex(g, 500, 500)).toBe(8);
    expect(hitIndex(g, -5, -5)).toBe(0);
  });

  it('moves by line and to a line’s ends', () => {
    expect(verticalMove(g, 1, 1, 10)).toBe(4);
    expect(verticalMove(g, 4, 1, 10)).toBe(7);
    expect(verticalMove(g, 7, 1, 10)).toBe(8);
    expect(verticalMove(g, 1, -1, 10)).toBe(0);
    expect(lineEnds(g, 4)).toEqual([3, 5]);
    expect(lineEnds(g, 7)).toEqual([6, 8]);
  });
});

describe('the selection', () => {
  it('covers each line it spans', () => {
    expect(selectionRects(g, 1, 1)).toEqual([]);
    expect(selectionRects(g, 1, 2)).toEqual([{ x: 10, y: 0, w: 10, h: 20 }]);
    const rects = selectionRects(g, 4, 7);
    expect(rects).toHaveLength(2);
    // The selected line break shows past the line.
    expect(rects[0]).toEqual({ x: 10, y: 20, w: 15, h: 20 });
    expect(rects[1]).toEqual({ x: 0, y: 40, w: 10, h: 20 });
    expect(selectionRects(g, 7, 4)).toEqual(rects);
  });

  it('selects words and paragraphs', () => {
    expect(wordAt(TEXT, 1)).toEqual([0, 2]);
    expect(wordAt(TEXT, 2)).toEqual([2, 3]);
    expect(wordAt(TEXT, 4)).toEqual([3, 5]);
    expect(wordAt('it’s fine', 1)).toEqual([0, 4]);
    expect(paragraphAt(TEXT, 1)).toEqual([0, 5]);
    expect(paragraphAt(TEXT, 7)).toEqual([6, 8]);
    expect(paragraphAt(TEXT, 6)).toEqual([6, 8]);
  });
});

describe('layer coordinates', () => {
  it('undo the layer’s transform', () => {
    expect(toLayer(g.transform, 110, 60)).toEqual({ x: 10, y: 10 });
    // Turned a quarter: page x follows layer y.
    const turned: TextGeometry['transform'] = [0, 1, -1, 0, 0, 0];
    const p = toLayer(turned, -5, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(5);
  });
});
