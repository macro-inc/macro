import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { UndoOutcome } from '@service-storage/generated/schemas/undoOutcome';
import type { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import {
  begin,
  type CombinedUndo,
  combineOutcomes,
  type DatabaseUndoEntry,
  type DatabaseUndoStack,
  destructiveLabel,
  EMPTY_UNDO_STACK,
  recordCommit,
  settle,
  take,
  type UndoDirection,
} from '../core/undo-stack';

/** What the undo stack needs from its host. */
export type DatabaseUndoCapabilities = {
  /** Undo one journal change of the viewer's own. */
  undoChange: (change: number) => ResultAsync<UndoOutcome, unknown>;
  /**
   * Calls back with each batch the viewer commits to this database; the
   * host ends the subscription with its owner.
   */
  onCommitted: (
    listener: (batch: { ops: DatabaseOp[]; changes: number[] }) => void
  ) => void;
  /** Offer an Undo for a destructive batch, on its toast. */
  offer: (label: string, undo: () => void) => void;
};

/**
 * The viewer's own edits to one database in this session, undone and redone newest first.
 * Requests run one at a time, in the order pressed; the stack moves at once.
 */
export function createDatabaseUndo(capabilities: DatabaseUndoCapabilities) {
  const [stack, setStack] = createSignal<DatabaseUndoStack>(EMPTY_UNDO_STACK);
  let queue: Promise<void> = Promise.resolve();

  capabilities.onCommitted(({ ops, changes }) => {
    const entry: DatabaseUndoEntry = { changes };
    setStack((current) => recordCommit(current, entry));
    const label = destructiveLabel(ops);
    if (label) capabilities.offer(label, () => undoEntry(entry));
  });

  async function revert(
    entry: DatabaseUndoEntry
  ): Promise<CombinedUndo | 'failed'> {
    const outcomes: UndoOutcome[] = [];
    // A batch's changes undo newest first, as its tables were written.
    for (const change of [...entry.changes].reverse()) {
      const outcome = await capabilities.undoChange(change);
      if (outcome.isErr()) return 'failed';
      outcomes.push(outcome.value);
    }
    return combineOutcomes(outcomes);
  }

  function enqueue(
    direction: UndoDirection,
    entry: DatabaseUndoEntry
  ): Promise<void> {
    queue = queue.then(async () => {
      const result = await revert(entry);
      setStack((current) => settle(current, direction, entry, result));
    });
    return queue;
  }

  function step(direction: UndoDirection): Promise<void> {
    const taken = begin(stack(), direction);
    if (!taken) return Promise.resolve();
    setStack(taken.stack);
    return enqueue(direction, taken.entry);
  }

  /** Undo one entry wherever it sits, as its toast's Undo does. */
  function undoEntry(entry: DatabaseUndoEntry): Promise<void> {
    const taken = take(stack(), entry);
    if (!taken) return Promise.resolve();
    setStack(taken);
    return enqueue('undo', entry);
  }

  return {
    canUndo: () => stack().undo.length > 0,
    canRedo: () => stack().redo.length > 0,
    undo: () => step('undo'),
    redo: () => step('redo'),
    /** Settles once every request pressed so far has. */
    settled: () => queue,
  };
}

export type DatabaseUndo = ReturnType<typeof createDatabaseUndo>;
