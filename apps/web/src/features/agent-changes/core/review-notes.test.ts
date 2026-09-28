import { describe, expect, it } from 'vitest';
import {
  composingAtLine,
  describeNoteLines,
  formatNotesForAgent,
  noteLines,
  notesAtLine,
  notesForFile,
  queuedNotes,
  type ReviewNote,
  sendableNotes,
} from './review-notes';

function note(overrides: Partial<ReviewNote> = {}): ReviewNote {
  return {
    id: 'n1',
    path: 'a.ts',
    side: 'additions',
    lineNumber: 10,
    endLineNumber: 10,
    text: 'Rename this',
    createdAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

describe('queuedNotes', () => {
  it('drops sent notes', () => {
    expect(
      queuedNotes([note(), note({ id: 'n2', sentAt: 't' })]).map((n) => n.id)
    ).toEqual(['n1']);
  });
});

describe('sendableNotes', () => {
  it('drops sent and empty notes and orders by file then line', () => {
    expect(
      sendableNotes([
        note({ id: 'b', path: 'b.ts', text: 'Keep' }),
        note({ id: 'empty', text: '   ' }),
        note({ id: 'sent', sentAt: 't' }),
        note({ id: 'a', lineNumber: 3, endLineNumber: 3 }),
      ]).map((n) => n.id)
    ).toEqual(['a', 'b']);
  });
});

describe('describeNoteLines', () => {
  it('names a single line and a range on each side', () => {
    expect(describeNoteLines(note())).toBe('line 10 (new)');
    expect(
      describeNoteLines(
        note({ side: 'deletions', lineNumber: 3, endLineNumber: 6 })
      )
    ).toBe('lines 3–6 (old)');
  });
});

describe('notesForFile', () => {
  it('filters by path and sorts by line', () => {
    const list = [
      note({ id: 'a', lineNumber: 20, endLineNumber: 20 }),
      note({ id: 'b', path: 'b.ts' }),
      note({ id: 'c', lineNumber: 5, endLineNumber: 5 }),
    ];
    expect(notesForFile(list, 'a.ts').map((n) => n.id)).toEqual(['c', 'a']);
  });
});

describe('noteLines', () => {
  it("hangs a file's notes and the new-note editor under the last line of each range", () => {
    const list = [
      note({ id: 'a', lineNumber: 8, endLineNumber: 10 }),
      note({ id: 'b' }),
      note({ id: 'other', path: 'b.ts' }),
    ];
    const composing = {
      path: 'a.ts',
      side: 'deletions' as const,
      lineNumber: 4,
      endLineNumber: 4,
    };
    expect(noteLines(list, composing, 'a.ts')).toEqual([
      { key: 'additions:10', side: 'additions', lineNumber: 10 },
      { key: 'deletions:4', side: 'deletions', lineNumber: 4 },
    ]);
    expect(notesAtLine(list, 'a.ts', 'additions:10').map((n) => n.id)).toEqual([
      'a',
      'b',
    ]);
    expect(composingAtLine(composing, 'a.ts', 'deletions:4')).toBe(composing);
    expect(composingAtLine(composing, 'a.ts', 'additions:10')).toBeUndefined();
    expect(noteLines(list, composing, 'c.ts')).toEqual([]);
  });
});

describe('formatNotesForAgent', () => {
  it('is empty without notes', () => {
    expect(formatNotesForAgent([])).toBe('');
  });

  it('writes one note as prose with its location', () => {
    expect(formatNotesForAgent([note()])).toBe(
      'Review note on `a.ts`, line 10 (new):\n\nRename this'
    );
  });

  it('numbers several notes in file and line order, naming ranges and sides', () => {
    const text = formatNotesForAgent([
      note({ id: 'b', path: 'b.ts', side: 'deletions', text: 'Keep this' }),
      note({
        id: 'a',
        lineNumber: 3,
        endLineNumber: 6,
        text: '  Extract a helper  ',
      }),
    ]);
    expect(text).toBe(
      [
        'Please address these 2 review notes on the current changes:',
        '',
        '1. `a.ts`, lines 3–6 (new): Extract a helper',
        '2. `b.ts`, line 10 (old): Keep this',
      ].join('\n')
    );
  });
});
