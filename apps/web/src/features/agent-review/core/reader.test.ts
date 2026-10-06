import { describe, expect, it } from 'vitest';
import { lineHtml } from './line-html';
import { displayRows, type ReviewFile } from './model';

describe('structural code rendering', () => {
  it('escapes source text even when the engine marks it as changed', () => {
    const text = '<script>alert("&")</script>';
    const html = lineHtml(text, [], [0, text.length]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&amp;&quot;');
  });

  it('keeps UTF-16 ranges aligned after astral characters', () => {
    expect(lineHtml('🦊 old', [3, 6, 6], [3, 6], 'old')).toBe(
      '🦊 <span class="review-syntax-type review-token-deleted">old</span>'
    );
  });

  it('shows both sides of an edited row in unified mode without dropping unchanged rows', () => {
    const file: ReviewFile = {
      path: 'test.ts',
      language: 'TypeScript',
      status: 'modified',
      added: 1,
      removed: 1,
      collapsed: null,
      labels: [],
      old: { lines: ['same', 'old'], syntax: [[], []], novel: [[], [0, 3]] },
      new: { lines: ['same', 'new'], syntax: [[], []], novel: [[], [0, 3]] },
      rows: [
        [0, 0],
        [1, 1],
      ],
    };
    expect(
      displayRows(file, false).map(({ old, new: next }) => [old, next])
    ).toEqual([
      [0, 0],
      [1, null],
      [null, 1],
    ]);
    expect(displayRows(file, true)).toHaveLength(2);
  });
});
