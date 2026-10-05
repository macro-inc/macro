import type {
  DeckOutline,
  ShapeOutline,
  SlideOutline,
  TextLayoutInfo,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { createSpeller, type Lexicon } from './spelling';
import {
  deckMisspellings,
  inQuad,
  replaceOps,
  slideTexts,
  wordGeometry,
} from './spelling-scan';

const lexicon: Lexicon = {
  words: new Set(['the', 'report', 'is', 'ready', 'total', 'revenue']),
  hidden: new Set(),
  replacements: [],
};
const speller = createSpeller(lexicon);

function shape(id: number, texts: string[], extra: Partial<ShapeOutline> = {}) {
  return {
    id,
    name: `Shape ${id}`,
    kind: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    rotation: 0,
    flipH: false,
    flipV: false,
    hidden: false,
    textEditable: true,
    paragraphs: texts.map((text) => ({ text, level: 0 })),
    ...extra,
  } as ShapeOutline;
}

function slide(
  id: number,
  index: number,
  shapes: ShapeOutline[]
): SlideOutline {
  return { id, index, layout: 'Blank', hidden: false, shapes };
}

const table = shape(9, [], {
  kind: 'table',
  textEditable: false,
  table: {
    rows: [
      ['Totl', ''],
      ['revenue\nrevnue', 'x'],
    ],
    columnWidths: [50, 50],
    rowHeights: [20, 20],
    laidOutRowHeights: [20, 20],
    cells: [
      [
        {
          rowSpan: 1,
          colSpan: 1,
          merged: false,
          anchor: 'top',
          margins: [0, 0, 0, 0],
        },
        {
          rowSpan: 1,
          colSpan: 1,
          merged: false,
          anchor: 'top',
          margins: [0, 0, 0, 0],
        },
      ],
      [
        {
          rowSpan: 1,
          colSpan: 1,
          merged: false,
          anchor: 'top',
          margins: [0, 0, 0, 0],
        },
        {
          rowSpan: 1,
          colSpan: 1,
          merged: true,
          anchor: 'top',
          margins: [0, 0, 0, 0],
        },
      ],
    ],
  },
});

describe('text sources', () => {
  it('lists shapes, group members, and table cells (merged cells skipped)', () => {
    const group = shape(5, [], {
      kind: 'group',
      textEditable: false,
      paragraphs: [],
      children: [shape(6, ['Teh report'])],
    });
    const sources = slideTexts(
      slide(256, 0, [shape(2, ['the']), group, table])
    );
    expect(sources.map((s) => [s.shape, s.cell])).toEqual([
      [2, undefined],
      [6, undefined],
      [9, { row: 0, col: 0 }],
      [9, { row: 1, col: 0 }],
    ]);
    expect(sources[3].paragraphs).toEqual(['revenue', 'revnue']);
  });
});

describe('deck walk', () => {
  const deck = {
    width: 960,
    height: 540,
    slides: [
      slide(256, 0, [shape(2, ['Teh report'])]),
      slide(257, 1, [shape(2, ['is redy']), table]),
    ],
    layouts: [],
    themeColors: [],
    tableStyles: [],
  } as DeckOutline;

  it('starts at a slide and wraps around', () => {
    const words = deckMisspellings(deck, 1, speller).map(
      (m) => `${m.slideIndex}:${m.word}`
    );
    expect(words).toEqual(['1:redy', '1:Totl', '1:revnue', '0:Teh']);
  });

  it('replaces later occurrences in a paragraph first, keeping formatting', () => {
    const [teh] = deckMisspellings(deck, 0, speller);
    expect(replaceOps([teh], 'The')).toEqual([
      {
        op: 'insertText',
        slide: 256,
        shape: 2,
        at: { paragraph: 0, offset: 3 },
        text: 'The',
      },
      {
        op: 'deleteText',
        slide: 256,
        shape: 2,
        start: { paragraph: 0, offset: 0 },
        end: { paragraph: 0, offset: 3 },
      },
    ]);
    const both = [
      { ...teh, start: 0, end: 3 },
      { ...teh, start: 8, end: 11 },
    ];
    const ops = replaceOps(both, 'x');
    expect(ops.map((o) => (o.op === 'insertText' ? o.at.offset : -1))).toEqual([
      11, -1, 3, -1,
    ]);
  });
});

describe('word geometry', () => {
  const layout: TextLayoutInfo = {
    transform: [1, 0, 0, 1, 10, 20],
    size: [200, 40],
    paragraphs: ['Teh report'],
    lines: [
      {
        paragraph: 0,
        top: 0,
        baseline: 14,
        bottom: 18,
        stops: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => ({
          index,
          x: index * 8,
        })),
      },
    ],
    styles: [],
  } as unknown as TextLayoutInfo;

  it('underlines a word just below the baseline, in slide space', () => {
    const g = wordGeometry(layout, 0, 0, 3);
    expect(g.underlines).toHaveLength(1);
    const [from, to] = g.underlines[0];
    expect(from.x).toBe(10);
    expect(to.x).toBe(34);
    expect(from.y).toBeGreaterThan(34);
    expect(from.y).toBeLessThan(38);
    expect(inQuad(g.boxes[0], { x: 20, y: 30 })).toBe(true);
    expect(inQuad(g.boxes[0], { x: 60, y: 30 })).toBe(false);
  });
});
