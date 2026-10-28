import type { LineBox, TextLayoutInfo } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { caretSegment, logicalArrow, positionAt } from './caret';
import { directionChoices, TEXT_DIRECTIONS } from './text-direction';

const line = (top: number, xs: number[]): LineBox => ({
  paragraph: 0,
  top,
  baseline: top + 18,
  bottom: top + 21.6,
  stops: xs.map((x, index) => ({ index, x })),
});

/** A 200 × 100 pt box at (72, 72) as the engine lays out its text. */
function layout(
  transform: TextLayoutInfo['transform'],
  lines: LineBox[]
): TextLayoutInfo {
  return {
    transform,
    size: [200, 100],
    paragraphs: ['Hello'],
    lines,
    styles: [],
  };
}

const LINES = [line(7.2, [3.6, 12, 20]), line(28.8, [3.6, 12, 20])];
/** Rotate all text 90°: layout x runs down the slide, layout y leftwards. */
const VERT = layout([0, 1, -1, 0, 272, 72], LINES);
/** Rotate all text 270°: layout x runs up, layout y rightwards. */
const VERT270 = layout([0, -1, 1, 0, 72, 172], LINES);
/** Stacked: lines listed from the layout's far side (left to right). */
const STACKED = layout(
  [0, 1, -1, 0, 272, 72],
  [line(171.2, [3.6, 25.2]), line(149.6, [3.6, 25.2])]
);

describe('arrow keys in vertical text', () => {
  it('keep their meaning in horizontal text', () => {
    const horizontal = layout([1, 0, 0, 1, 72, 72], LINES);
    expect(logicalArrow(horizontal, 'left')).toBe('left');
    expect(logicalArrow(horizontal, 'right')).toBe('right');
    expect(logicalArrow(horizontal, 'up')).toBe('up');
    expect(logicalArrow(horizontal, 'down')).toBe('down');
  });

  it('follow the screen in text rotated 90°', () => {
    expect(logicalArrow(VERT, 'down')).toBe('right');
    expect(logicalArrow(VERT, 'up')).toBe('left');
    // Lines stack right to left: Left goes to the next line.
    expect(logicalArrow(VERT, 'left')).toBe('down');
    expect(logicalArrow(VERT, 'right')).toBe('up');
  });

  it('follow the screen in text rotated 270°', () => {
    expect(logicalArrow(VERT270, 'up')).toBe('right');
    expect(logicalArrow(VERT270, 'down')).toBe('left');
    expect(logicalArrow(VERT270, 'right')).toBe('down');
    expect(logicalArrow(VERT270, 'left')).toBe('up');
  });

  it('follow lines stacked left to right', () => {
    expect(logicalArrow(STACKED, 'down')).toBe('right');
    expect(logicalArrow(STACKED, 'right')).toBe('down');
    expect(logicalArrow(STACKED, 'left')).toBe('up');
  });
});

describe('carets in vertical text', () => {
  it('lie across the line in slide space', () => {
    const [a, b] = caretSegment(VERT, { paragraph: 0, offset: 1 }) ?? [];
    // Stop 12 pt down the line, from the line's top (right) to its bottom.
    expect(a).toEqual({ x: 272 - 7.2, y: 84 });
    expect(b?.x).toBeCloseTo(272 - 28.8);
    expect(b?.y).toBe(84);
  });

  it('hit test through the rotation', () => {
    expect(positionAt(VERT, { x: 260, y: 92 })).toEqual({
      paragraph: 0,
      offset: 2,
    });
  });
});

describe('Text Direction choices', () => {
  it('are PowerPoint’s four', () => {
    expect(TEXT_DIRECTIONS.map((d) => d.label)).toEqual([
      'Horizontal',
      'Rotate all text 90°',
      'Rotate all text 270°',
      'Stacked',
    ]);
  });

  it('add an East Asian direction when the text has one', () => {
    expect(directionChoices('vert')).toHaveLength(4);
    expect(directionChoices('eaVert').map((d) => d.value)).toContain('eaVert');
  });
});
