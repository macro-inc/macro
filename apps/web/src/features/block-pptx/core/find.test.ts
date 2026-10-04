import type { DeckOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { findInDeck, matchesIn, replaceAllOps } from './find';

const deck = {
  width: 960,
  height: 540,
  layouts: [],
  themeColors: [],
  slides: [
    {
      id: 256,
      index: 0,
      layout: 'Title',
      hidden: false,
      shapes: [
        {
          id: 2,
          name: 'Title',
          kind: 'text',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
          hidden: false,
          textEditable: true,
          paragraphs: [{ text: 'Revenue and revenue growth', level: 0 }],
        },
        {
          id: 3,
          name: 'Table',
          kind: 'table',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
          hidden: false,
          textEditable: false,
          table: {
            rows: [['Q1', 'Revenue\nNet revenue']],
            columnWidths: [1, 1],
            rowHeights: [1],
          },
        },
      ],
    },
  ],
} satisfies DeckOutline;

describe('find', () => {
  it('matches case-insensitively by default', () => {
    expect(
      matchesIn('Revenue and revenue', 'revenue', {
        matchCase: false,
        wholeWord: false,
      })
    ).toEqual([
      [0, 7],
      [12, 19],
    ]);
  });

  it('respects case and whole words', () => {
    const opts = { matchCase: true, wholeWord: true };
    expect(matchesIn('revenues revenue', 'revenue', opts)).toEqual([[9, 16]]);
    expect(matchesIn('Revenue', 'revenue', opts)).toEqual([]);
  });

  it('finds text in shapes and table cells', () => {
    const found = findInDeck(deck, 'revenue', {
      matchCase: false,
      wholeWord: false,
    });
    expect(found).toHaveLength(4);
    expect(found[2]).toMatchObject({
      shape: 3,
      cell: { row: 0, col: 1 },
      paragraph: 0,
    });
    expect(found[3]).toMatchObject({ paragraph: 1, start: 4, end: 11 });
  });

  it('replaces later matches in a paragraph first', () => {
    const found = findInDeck(deck, 'revenue', {
      matchCase: false,
      wholeWord: false,
    }).slice(0, 2);
    const ops = replaceAllOps(found, 'sales');
    expect(ops.map((o) => o.op)).toEqual([
      'deleteText',
      'insertText',
      'deleteText',
      'insertText',
    ]);
    expect(ops[0]).toMatchObject({ start: { offset: 12 } });
  });
});
