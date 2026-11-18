import { describe, expect, it } from 'vitest';
import { literalSearchRange } from './search-match';

describe('literal search ranges', () => {
  it('keeps original offsets after a character with expanding lowercase', () => {
    expect(literalSearchRange('İstanbul', 'stan')).toEqual({
      start: 1,
      end: 5,
    });
  });
  it('treats punctuation as literal text and compares case-insensitively', () => {
    expect(literalSearchRange('Notes [Draft].md', '[draft].')).toEqual({
      start: 6,
      end: 14,
    });
  });
  it('omits empty and absent matches', () => {
    expect(literalSearchRange('Notes', ' ')).toBeUndefined();
    expect(literalSearchRange('Notes', 'summary')).toBeUndefined();
  });
});
