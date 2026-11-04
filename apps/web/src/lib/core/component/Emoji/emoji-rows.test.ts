import { describe, expect, it } from 'vitest';
import type { SimpleEmoji } from './emoji-catalog';
import { emojiRows } from './emoji-rows';

const emoji = (char: string): SimpleEmoji => ({
  emoji: char,
  slug: char,
  shortcodes: [char],
  terms: [],
});

describe('emojiRows', () => {
  it('puts each section name above its emojis, a row per `columns`', () => {
    const { rows } = emojiRows(
      [
        { name: 'Frequently used', emojis: ['a', 'b', 'c'].map(emoji) },
        { name: 'Smileys', emojis: ['d', 'e'].map(emoji) },
      ],
      2
    );

    expect(
      rows.map((row) =>
        row.kind === 'header'
          ? row.name
          : `${row.start}:${row.emojis.map(({ emoji }) => emoji).join('')}`
      )
    ).toEqual(['Frequently used', '0:ab', '2:c', 'Smileys', '3:de']);
  });

  it('skips empty sections', () => {
    const { rows } = emojiRows(
      [
        { name: 'Frequently used', emojis: [] },
        { name: 'Smileys', emojis: [emoji('a')] },
      ],
      6
    );

    expect(rows.map((row) => row.kind)).toEqual(['header', 'emojis']);
  });

  it('maps every emoji to the row that shows it', () => {
    const { rows, rowOfEmoji } = emojiRows(
      [
        { name: 'One', emojis: ['a', 'b', 'c'].map(emoji) },
        { name: 'Two', emojis: ['d'].map(emoji) },
      ],
      2
    );

    expect(rowOfEmoji).toEqual([1, 1, 2, 4]);
    for (const [index, row] of rowOfEmoji.entries()) {
      const shown = rows[row];
      expect(shown.kind).toBe('emojis');
      if (shown.kind !== 'emojis') continue;
      expect(index - shown.start).toBeLessThan(shown.emojis.length);
    }
  });
});
