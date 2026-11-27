export type UndoableEntityType =
  | 'document'
  | 'project'
  | 'chat'
  | 'email'
  | 'database'
  | 'form';

export type UndoableEntityRef = {
  id: string;
  type: UndoableEntityType;
  name: string;
};

export type MoveUndoItem = {
  entity: UndoableEntityRef;
  /** Previous parent folder ID, or null when the item lived at Drive root. */
  previousProjectId: string | null;
};

export type DriveUndoAction =
  | {
      id: string;
      kind: 'move';
      items: MoveUndoItem[];
      destinationFolderId: string | null;
      destinationName: string;
    }
  | {
      id: string;
      kind: 'trash';
      items: UndoableEntityRef[];
    }
  | {
      id: string;
      kind: 'rename';
      entity: UndoableEntityRef;
      previousName: string;
      nextName: string;
    };

export const MAX_DRIVE_UNDO_ENTRIES = 25;

export function pushUndoAction(
  stack: readonly DriveUndoAction[],
  action: DriveUndoAction,
  maxEntries: number = MAX_DRIVE_UNDO_ENTRIES
): DriveUndoAction[] {
  const next = [...stack, action];
  if (next.length <= maxEntries) return next;
  return next.slice(next.length - maxEntries);
}

export function popLatestUndoAction(stack: readonly DriveUndoAction[]): {
  action: DriveUndoAction | undefined;
  rest: DriveUndoAction[];
} {
  if (stack.length === 0) return { action: undefined, rest: [] };
  return {
    action: stack[stack.length - 1],
    rest: stack.slice(0, -1),
  };
}

export function takeUndoActionById(
  stack: readonly DriveUndoAction[],
  id: string
): { action: DriveUndoAction | undefined; rest: DriveUndoAction[] } {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index < 0) return { action: undefined, rest: [...stack] };
  return {
    action: stack[index],
    rest: [...stack.slice(0, index), ...stack.slice(index + 1)],
  };
}
