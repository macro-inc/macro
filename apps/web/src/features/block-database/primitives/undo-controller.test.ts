import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { UndoOutcome } from '@service-storage/generated/schemas/undoOutcome';
import { okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createDatabaseUndo } from './undo-controller';

describe('the database undo controller', () => {
  it('undoes the viewer’s last batch, redoes it, and offers Undo on a deletion', async () => {
    const commits: ((batch: {
      ops: DatabaseOp[];
      changes: number[];
    }) => void)[] = [];
    const undone: number[] = [];
    const offered: string[] = [];
    const outcomes: Record<number, UndoOutcome> = {
      3: {
        kind: 'reverted',
        changes: [{ change: 4, table: 'guests', version: 4 }],
      },
      4: {
        kind: 'reverted',
        changes: [{ change: 5, table: 'guests', version: 5 }],
      },
    };
    const undo = createRoot(() =>
      createDatabaseUndo({
        undoChange: (change) => {
          undone.push(change);
          return okAsync(outcomes[change]!);
        },
        onCommitted: (listener) => commits.push(listener),
        offer: (label) => offered.push(label),
      })
    );

    commits[0]!({
      ops: [
        {
          kind: 'rows',
          table: 'guests',
          change: { kind: 'delete', rows: ['omar'] },
        },
      ],
      changes: [3],
    });
    const before = [undo.canUndo(), undo.canRedo()];
    await undo.undo();
    const afterUndo = [undo.canUndo(), undo.canRedo()];
    await undo.redo();

    expect(offered).toEqual(['Row deleted']);
    expect(before).toEqual([true, false]);
    expect(afterUndo).toEqual([false, true]);
    expect([undo.canUndo(), undo.canRedo()]).toEqual([true, false]);
    expect(undone).toEqual([3, 4]);
  });

  it('drops a refused entry off the stack', async () => {
    const commits: ((batch: {
      ops: DatabaseOp[];
      changes: number[];
    }) => void)[] = [];
    const undo = createRoot(() =>
      createDatabaseUndo({
        undoChange: () =>
          okAsync({
            kind: 'refused',
            reason: 'row_edited_since',
            by: 'Julia',
          }),
        onCommitted: (listener) => commits.push(listener),
        offer: () => {},
      })
    );

    commits[0]!({ ops: [], changes: [2] });
    await undo.undo();

    expect([undo.canUndo(), undo.canRedo()]).toEqual([false, false]);
  });
});
