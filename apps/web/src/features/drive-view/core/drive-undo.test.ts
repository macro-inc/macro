import { describe, expect, it } from 'vitest';
import {
  type DriveUndoAction,
  popLatestUndoAction,
  pushUndoAction,
  takeUndoActionById,
} from './drive-undo';

function renameAction(id: string): DriveUndoAction {
  return {
    id,
    kind: 'rename',
    entity: { id: `e-${id}`, type: 'document', name: `After ${id}` },
    previousName: `Before ${id}`,
    nextName: `After ${id}`,
  };
}

describe('drive-undo', () => {
  it('enforces max depth, pops LIFO, and removes specific entries by id', () => {
    let stack: DriveUndoAction[] = [];
    stack = pushUndoAction(stack, renameAction('1'), 2);
    stack = pushUndoAction(stack, renameAction('2'), 2);
    stack = pushUndoAction(stack, renameAction('3'), 2);
    expect(stack.map((a) => a.id)).toEqual(['2', '3']);

    const byId = takeUndoActionById(stack, '2');
    expect(byId.action?.id).toBe('2');
    expect(byId.rest.map((a) => a.id)).toEqual(['3']);

    const popped = popLatestUndoAction(byId.rest);
    expect(popped.action?.id).toBe('3');
    expect(popped.rest).toEqual([]);
    expect(popLatestUndoAction([])).toEqual({ action: undefined, rest: [] });
  });
});
