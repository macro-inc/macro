import { type Accessor, createSignal } from 'solid-js';
import {
  type DriveUndoAction,
  type MoveUndoItem,
  popLatestUndoAction,
  pushUndoAction,
  takeUndoActionById,
  type UndoableEntityRef,
} from '../core/drive-undo';

export type DriveUndoExecutors = {
  undoMove: (items: readonly MoveUndoItem[]) => Promise<boolean>;
  undoTrash: (items: readonly UndoableEntityRef[]) => Promise<boolean>;
  undoRename: (
    entity: UndoableEntityRef,
    previousName: string
  ) => Promise<boolean>;
};

export type DriveUndoResult =
  | { status: 'empty' }
  | { status: 'busy' }
  | { status: 'undone'; action: DriveUndoAction }
  | { status: 'failed'; action: DriveUndoAction };

export type DriveUndoManager = {
  canUndo: Accessor<boolean>;
  isUndoing: Accessor<boolean>;
  latest: Accessor<DriveUndoAction | undefined>;
  size: Accessor<number>;
  recordMove: (params: {
    items: MoveUndoItem[];
    destinationFolderId: string | null;
    destinationName: string;
  }) => string;
  recordTrash: (items: UndoableEntityRef[]) => string;
  recordRename: (params: {
    entity: UndoableEntityRef;
    previousName: string;
    nextName: string;
  }) => string;
  undoLatest: () => Promise<DriveUndoResult>;
  undoById: (id: string) => Promise<DriveUndoResult>;
  clear: () => void;
};

let nextUndoSequence = 1;
function createUndoId(): string {
  const id = `drive-undo-${nextUndoSequence}`;
  nextUndoSequence += 1;
  return id;
}

/**
 * Reactive Drive undo manager supporting both toast Undo buttons (`undoById`)
 * and keyboard `Cmd+Z` (`undoLatest`) without double-applying an entry.
 */
export function createDriveUndoManager(
  executors: DriveUndoExecutors
): DriveUndoManager {
  const [stack, setStack] = createSignal<DriveUndoAction[]>([]);
  const [isUndoing, setIsUndoing] = createSignal(false);

  const executeUndo = async (
    action: DriveUndoAction
  ): Promise<DriveUndoResult> => {
    setIsUndoing(true);
    try {
      let ok = false;
      if (action.kind === 'move') {
        ok = await executors.undoMove(action.items);
      } else if (action.kind === 'trash') {
        ok = await executors.undoTrash(action.items);
      } else {
        ok = await executors.undoRename(action.entity, action.previousName);
      }
      if (!ok) {
        // Put the entry back on top so the user can retry.
        setStack((current) => pushUndoAction(current, action));
        return { status: 'failed', action };
      }
      return { status: 'undone', action };
    } catch {
      setStack((current) => pushUndoAction(current, action));
      return { status: 'failed', action };
    } finally {
      setIsUndoing(false);
    }
  };

  return {
    canUndo: () => stack().length > 0,
    isUndoing,
    latest: () => stack().at(-1),
    size: () => stack().length,

    recordMove: ({ items, destinationFolderId, destinationName }) => {
      const id = createUndoId();
      setStack((current) =>
        pushUndoAction(current, {
          id,
          kind: 'move',
          items,
          destinationFolderId,
          destinationName,
        })
      );
      return id;
    },

    recordTrash: (items) => {
      const id = createUndoId();
      setStack((current) =>
        pushUndoAction(current, { id, kind: 'trash', items })
      );
      return id;
    },

    recordRename: ({ entity, previousName, nextName }) => {
      const id = createUndoId();
      setStack((current) =>
        pushUndoAction(current, {
          id,
          kind: 'rename',
          entity,
          previousName,
          nextName,
        })
      );
      return id;
    },

    undoLatest: async () => {
      if (isUndoing()) return { status: 'busy' };
      const { action, rest } = popLatestUndoAction(stack());
      if (!action) return { status: 'empty' };
      setStack(rest);
      return executeUndo(action);
    },

    undoById: async (id) => {
      if (isUndoing()) return { status: 'busy' };
      const { action, rest } = takeUndoActionById(stack(), id);
      if (!action) return { status: 'empty' };
      setStack(rest);
      return executeUndo(action);
    },

    clear: () => setStack([]),
  };
}
