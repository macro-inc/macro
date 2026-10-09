import type { SkippedCell } from '@service-storage/generated/schemas/skippedCell';
import type { UndoOutcome } from '@service-storage/generated/schemas/undoOutcome';
import type { UndoRefusal } from '@service-storage/generated/schemas/undoRefusal';
import { match } from 'ts-pattern';
import type { DatabaseOp } from '../../../lib/core/database-sql/generated/types';

/** One batch the viewer committed: the journal's change for each table it wrote. */
export type DatabaseUndoEntry = {
  readonly changes: readonly number[];
};

/** The viewer's own committed batches in this session, newest last, and those undone since. */
export type DatabaseUndoStack = {
  readonly undo: readonly DatabaseUndoEntry[];
  readonly redo: readonly DatabaseUndoEntry[];
};

export type UndoDirection = 'undo' | 'redo';

export const EMPTY_UNDO_STACK: DatabaseUndoStack = { undo: [], redo: [] };

/** A new edit: it can be undone, and what was undone before can no longer be redone. */
export function recordCommit(
  stack: DatabaseUndoStack,
  entry: DatabaseUndoEntry
): DatabaseUndoStack {
  if (entry.changes.length === 0) return stack;
  return { undo: [...stack.undo, entry], redo: [] };
}

/**
 * Take the newest entry of one side, optimistically: it leaves the stack at once, so a second
 * press takes the next one while the first is still on its way.
 */
export function begin(
  stack: DatabaseUndoStack,
  direction: UndoDirection
): { entry: DatabaseUndoEntry; stack: DatabaseUndoStack } | undefined {
  const side = stack[direction];
  const entry = side.at(-1);
  if (!entry) return undefined;
  return { entry, stack: { ...stack, [direction]: side.slice(0, -1) } };
}

/** Take one entry out wherever it is, as an Undo button on its toast does. */
export function take(
  stack: DatabaseUndoStack,
  entry: DatabaseUndoEntry
): DatabaseUndoStack | undefined {
  if (!stack.undo.includes(entry)) return undefined;
  return { ...stack, undo: stack.undo.filter((held) => held !== entry) };
}

/** What undoing (or redoing) one entry's changes came to, all of them together. */
export type CombinedUndo =
  /** Something reverted; the cells others changed since were left alone. */
  | {
      kind: 'undone';
      changes: number[];
      skipped: SkippedCell[];
    }
  /** Nothing reverted: every cell was changed by someone since. */
  | { kind: 'skipped'; skipped: SkippedCell[] }
  /** Nothing reverted, and why. */
  | { kind: 'refused'; reason: UndoRefusal; by: string | null };

/** One entry's outcomes, one per change, as one: anything reverted counts as undone. */
export function combineOutcomes(
  outcomes: readonly UndoOutcome[]
): CombinedUndo {
  const changes: number[] = [];
  const skipped: SkippedCell[] = [];
  let refusal: { reason: UndoRefusal; by: string | null } | undefined;
  for (const outcome of outcomes) {
    match(outcome)
      .with({ kind: 'reverted' }, (reverted) => {
        changes.push(...reverted.changes.map(({ change }) => change));
      })
      .with({ kind: 'partial' }, (partial) => {
        changes.push(...partial.changes.map(({ change }) => change));
        skipped.push(...partial.skipped);
      })
      .with({ kind: 'refused' }, (refused) => {
        refusal ??= { reason: refused.reason, by: refused.by };
      })
      .exhaustive();
  }
  if (changes.length > 0) return { kind: 'undone', changes, skipped };
  if (refusal) return { kind: 'refused', ...refusal };
  return { kind: 'skipped', skipped };
}

/**
 * Settle a taken entry. An undone one moves to the other side under the changes the undo made,
 * whose undo is the redo; a refused or fully skipped one drops off; a request that failed puts
 * the entry back where it was.
 */
export function settle(
  stack: DatabaseUndoStack,
  direction: UndoDirection,
  entry: DatabaseUndoEntry,
  result: CombinedUndo | 'failed'
): DatabaseUndoStack {
  if (result === 'failed') {
    return { ...stack, [direction]: [...stack[direction], entry] };
  }
  if (result.kind !== 'undone') return stack;
  const other: UndoDirection = direction === 'undo' ? 'redo' : 'undo';
  return {
    ...stack,
    [other]: [...stack[other], { changes: result.changes }],
  };
}

/** The words for a batch worth an Undo on its toast: one that deleted rows, a column or an option. */
export function destructiveLabel(
  ops: readonly DatabaseOp[]
): string | undefined {
  let rows = 0;
  let columns = 0;
  let options = 0;
  for (const op of ops) {
    if (op.kind === 'rows' && op.change.kind === 'delete')
      rows += op.change.rows.length;
    if (op.kind === 'column' && op.change.kind === 'delete') columns += 1;
    if (op.kind === 'column' && op.change.kind === 'delete_option')
      options += 1;
  }
  if (columns > 0)
    return columns === 1 ? 'Column deleted' : `${columns} columns deleted`;
  if (rows > 0) return rows === 1 ? 'Row deleted' : `${rows} rows deleted`;
  if (options > 0)
    return options === 1 ? 'Option deleted' : `${options} options deleted`;
  return undefined;
}
