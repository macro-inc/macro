import type { SimpleEmoji } from './emoji-catalog';

export type EmojiRow =
  | { kind: 'header'; name: string }
  /** `start` is the first emoji's index across every section. */
  | { kind: 'emojis'; emojis: SimpleEmoji[]; start: number };

/**
 * Lays the picker's sections out as rows for its virtual list: each non-empty
 * section's name, then its emojis `columns` to a row. `rowOfEmoji` maps an
 * emoji's index across every section to its row, for scrolling the keyboard
 * selection into view.
 */
export function emojiRows(
  sections: readonly { name: string; emojis: readonly SimpleEmoji[] }[],
  columns: number
): { rows: EmojiRow[]; rowOfEmoji: number[] } {
  const rows: EmojiRow[] = [];
  const rowOfEmoji: number[] = [];
  let start = 0;
  for (const { name, emojis } of sections) {
    if (emojis.length === 0) continue;
    rows.push({ kind: 'header', name });
    for (let offset = 0; offset < emojis.length; offset += columns) {
      const row = emojis.slice(offset, offset + columns);
      for (let i = 0; i < row.length; i++) rowOfEmoji.push(rows.length);
      rows.push({ kind: 'emojis', emojis: row, start: start + offset });
    }
    start += emojis.length;
  }
  return { rows, rowOfEmoji };
}
