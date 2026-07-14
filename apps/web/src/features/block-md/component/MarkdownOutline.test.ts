import { describe, expect, it } from 'vitest';
import { getActiveHeadingIndex } from './MarkdownOutline';

describe('getActiveHeadingIndex', () => {
  it('selects the first heading before the document reaches it', () => {
    expect(getActiveHeadingIndex([120, 320, 640], 80)).toBe(0);
  });

  it('selects the last heading above the active line', () => {
    expect(getActiveHeadingIndex([20, 100, 300], 150)).toBe(1);
  });

  it('returns no selection when the document has no headings', () => {
    expect(getActiveHeadingIndex([], 150)).toBe(-1);
  });
});
