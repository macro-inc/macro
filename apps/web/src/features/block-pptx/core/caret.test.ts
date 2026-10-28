import type { TextLayoutInfo } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  caretSegment,
  lineEdge,
  lineIndexOf,
  moveHorizontal,
  moveVertical,
  moveWord,
  positionAt,
  selectionQuads,
  textInRange,
  wordAt,
} from './caret';

/** "Hello world" wrapped after "Hello ", then an empty paragraph. 10pt per char. */
const layout: TextLayoutInfo = {
  transform: [1, 0, 0, 1, 100, 200],
  size: [200, 100],
  paragraphs: ['Hello world', ''],
  lines: [
    {
      paragraph: 0,
      top: 0,
      baseline: 12,
      bottom: 15,
      stops: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ index: i, x: 5 + i * 10 })),
    },
    {
      paragraph: 0,
      top: 15,
      baseline: 27,
      bottom: 30,
      stops: [6, 7, 8, 9, 10, 11].map((i) => ({
        index: i,
        x: 5 + (i - 6) * 10,
      })),
    },
    {
      paragraph: 1,
      top: 30,
      baseline: 42,
      bottom: 45,
      stops: [{ index: 0, x: 5 }],
    },
  ],
  styles: [],
};

describe('caret placement', () => {
  it('puts a wrapped line end on the next line', () => {
    expect(lineIndexOf(layout, { paragraph: 0, offset: 6 })).toBe(1);
    expect(lineIndexOf(layout, { paragraph: 0, offset: 5 })).toBe(0);
    expect(lineIndexOf(layout, { paragraph: 0, offset: 11 })).toBe(1);
    expect(lineIndexOf(layout, { paragraph: 1, offset: 0 })).toBe(2);
  });

  it('maps positions to slide-space segments and back', () => {
    expect(caretSegment(layout, { paragraph: 0, offset: 2 })).toEqual([
      { x: 125, y: 200 },
      { x: 125, y: 215 },
    ]);
    expect(positionAt(layout, { x: 127, y: 205 })).toEqual({
      paragraph: 0,
      offset: 2,
    });
    expect(positionAt(layout, { x: 1000, y: 220 })).toEqual({
      paragraph: 0,
      offset: 11,
    });
    expect(positionAt(layout, { x: 0, y: 900 })).toEqual({
      paragraph: 1,
      offset: 0,
    });
  });
});

describe('caret movement', () => {
  it('crosses paragraph boundaries horizontally', () => {
    expect(moveHorizontal(layout, { paragraph: 0, offset: 11 }, 1)).toEqual({
      paragraph: 1,
      offset: 0,
    });
    expect(moveHorizontal(layout, { paragraph: 1, offset: 0 }, -1)).toEqual({
      paragraph: 0,
      offset: 11,
    });
    expect(moveHorizontal(layout, { paragraph: 0, offset: 0 }, -1)).toEqual({
      paragraph: 0,
      offset: 0,
    });
  });

  it('moves by words', () => {
    expect(moveWord(layout, { paragraph: 0, offset: 0 }, 1)).toEqual({
      paragraph: 0,
      offset: 5,
    });
    expect(moveWord(layout, { paragraph: 0, offset: 5 }, 1)).toEqual({
      paragraph: 0,
      offset: 11,
    });
    expect(moveWord(layout, { paragraph: 0, offset: 11 }, -1)).toEqual({
      paragraph: 0,
      offset: 6,
    });
  });

  it('keeps the goal column vertically', () => {
    const down = moveVertical(layout, { paragraph: 0, offset: 3 }, 1);
    expect(down.pos).toEqual({ paragraph: 0, offset: 9 });
    const up = moveVertical(layout, down.pos, -1, down.goalX);
    expect(up.pos).toEqual({ paragraph: 0, offset: 3 });
    expect(moveVertical(layout, { paragraph: 0, offset: 3 }, -1).pos).toEqual({
      paragraph: 0,
      offset: 0,
    });
  });

  it('finds line edges and words', () => {
    expect(lineEdge(layout, { paragraph: 0, offset: 2 }, true)).toEqual({
      paragraph: 0,
      offset: 5,
    });
    expect(lineEdge(layout, { paragraph: 0, offset: 8 }, false)).toEqual({
      paragraph: 0,
      offset: 6,
    });
    expect(wordAt(layout, { paragraph: 0, offset: 8 })).toEqual([
      { paragraph: 0, offset: 6 },
      { paragraph: 0, offset: 11 },
    ]);
  });
});

describe('selections', () => {
  it('covers each touched line and the paragraph break', () => {
    const quads = selectionQuads(
      layout,
      { paragraph: 0, offset: 4 },
      { paragraph: 1, offset: 0 }
    );
    expect(quads).toHaveLength(2);
    expect(quads[0][0]).toEqual({ x: 145, y: 200 });
    // The last line of paragraph 0 includes a sliver for the break.
    expect(quads[1][1].x).toBe(100 + 55 + 4);
    expect(
      textInRange(
        layout,
        { paragraph: 0, offset: 4 },
        { paragraph: 1, offset: 0 }
      )
    ).toBe('o world\n');
  });

  it('draws nothing for a collapsed range', () => {
    expect(
      selectionQuads(
        layout,
        { paragraph: 0, offset: 3 },
        { paragraph: 0, offset: 3 }
      )
    ).toEqual([]);
  });
});
