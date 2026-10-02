import { describe, expect, it } from 'vitest';
import {
  begin,
  combineOutcomes,
  destructiveLabel,
  EMPTY_UNDO_STACK,
  recordCommit,
  settle,
  take,
} from './undo-stack';

describe('the database undo stack', () => {
  it('pushes each committed batch, and a new edit forgets what could be redone', () => {
    const first = { changes: [1] };
    const second = { changes: [2, 3] };
    const undone = { changes: [9] };

    const pushed = recordCommit(
      recordCommit({ undo: [], redo: [undone] }, first),
      second
    );

    expect(pushed).toEqual({ undo: [first, second], redo: [] });
  });

  it('ignores a batch that changed nothing', () => {
    expect(recordCommit(EMPTY_UNDO_STACK, { changes: [] })).toEqual(
      EMPTY_UNDO_STACK
    );
  });

  it('takes the newest entry at once, and an undone one moves to redo under the undo’s changes', () => {
    const first = { changes: [1] };
    const second = { changes: [2] };
    const taken = begin({ undo: [first, second], redo: [] }, 'undo');

    expect(taken).toEqual({
      entry: second,
      stack: { undo: [first], redo: [] },
    });
    expect(
      settle(taken!.stack, 'undo', second, {
        kind: 'undone',
        changes: [7],
        skipped: [],
      })
    ).toEqual({ undo: [first], redo: [{ changes: [7] }] });
  });

  it('redoes by undoing the undo, and the redo comes back to the undo side', () => {
    const undone = { changes: [7] };
    const taken = begin({ undo: [], redo: [undone] }, 'redo');

    expect(
      settle(taken!.stack, 'redo', undone, {
        kind: 'undone',
        changes: [8],
        skipped: [],
      })
    ).toEqual({ undo: [{ changes: [8] }], redo: [] });
  });

  it('drops a refused or fully skipped entry, and puts a failed one back', () => {
    const entry = { changes: [4] };
    const stack = { undo: [], redo: [] };

    expect(
      settle(stack, 'undo', entry, {
        kind: 'refused',
        reason: 'row_edited_since',
        by: 'macro|julia@macro.com',
      })
    ).toEqual({ undo: [], redo: [] });
    expect(
      settle(stack, 'undo', entry, { kind: 'skipped', skipped: [] })
    ).toEqual({ undo: [], redo: [] });
    expect(settle(stack, 'undo', entry, 'failed')).toEqual({
      undo: [entry],
      redo: [],
    });
  });

  it('takes one entry from anywhere for its toast’s Undo, once', () => {
    const first = { changes: [1] };
    const second = { changes: [2] };

    expect(take({ undo: [first, second], redo: [] }, first)).toEqual({
      undo: [second],
      redo: [],
    });
    expect(take({ undo: [second], redo: [] }, first)).toBeUndefined();
  });
});

describe('an undo’s outcomes', () => {
  it('count a partial undo as undone, with the cells left alone', () => {
    expect(
      combineOutcomes([
        {
          kind: 'partial',
          skipped: [
            { row: 'maria', column: 'rsvp', by: 'macro|julia@macro.com' },
          ],
          changes: [{ change: 7, table: 'guests', version: 5 }],
        },
      ])
    ).toEqual({
      kind: 'undone',
      changes: [7],
      skipped: [{ row: 'maria', column: 'rsvp', by: 'macro|julia@macro.com' }],
    });
  });

  it('are refused when nothing reverted and a change refused', () => {
    expect(
      combineOutcomes([
        {
          kind: 'refused',
          reason: 'row_edited_since',
          by: 'macro|julia@macro.com',
        },
      ])
    ).toEqual({
      kind: 'refused',
      reason: 'row_edited_since',
      by: 'macro|julia@macro.com',
    });
  });
});

describe('a destructive batch', () => {
  it('is labelled for its toast’s Undo', () => {
    expect(
      destructiveLabel([
        {
          kind: 'rows',
          table: 'guests',
          change: { kind: 'delete', rows: ['maria', 'omar'] },
        },
      ])
    ).toBe('2 rows deleted');
    expect(
      destructiveLabel([
        {
          kind: 'column',
          table: 'guests',
          column: 'plus-ones',
          change: { kind: 'delete' },
        },
      ])
    ).toBe('Column deleted');
    expect(
      destructiveLabel([
        {
          kind: 'rows',
          table: 'guests',
          change: {
            kind: 'update',
            changes: { kind: 'uniform', rows: ['maria'], cells: [] },
          },
        },
      ])
    ).toBeUndefined();
  });
});
