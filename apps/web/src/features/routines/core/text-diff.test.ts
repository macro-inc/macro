import { describe, expect, it } from 'vitest';
import { diffLines, diffWords } from './text-diff';

describe('text diffs', () => {
  it('marks the words a rewrite inserts, apart from punctuation', () => {
    expect(
      diffWords(
        'Check tasks due within 3 days.',
        'Check tasks due within 3 days and overdue tasks.'
      )
    ).toEqual([
      { text: 'Check tasks due within 3 days', change: 'same' },
      { text: ' and overdue tasks', change: 'added' },
      { text: '.', change: 'same' },
    ]);
  });

  it('marks removed and added lines of code', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { text: 'a\n', change: 'same' },
      { text: 'b\n', change: 'removed' },
      { text: 'B\n', change: 'added' },
      { text: 'c\n', change: 'same' },
      { text: 'd\n', change: 'added' },
    ]);
  });
});
