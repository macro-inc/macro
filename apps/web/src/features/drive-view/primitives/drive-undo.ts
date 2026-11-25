import { type Accessor, createSignal } from 'solid-js';
import {
  type DriveUndoAction,
  type MoveUndoItem,
  popLatestUndoAction,
  pushUndoAction,
  takeUndoActionById,
  type UndoableEntityRef,
} from '../core/drive-undo';

export type DriveMoveUndoOutcome =
  | boolean
  | { failedItems: MoveUndoItem[]; skipped?: boolean };

export type DriveTrashUndoOutcome =
  | boolean
  | { failedItems: UndoableEntityRef[] };

export type DriveRenameUndoOutcome = boolean | 'skipped';

export type DriveUndoExecutors = {
  undoMove: (
    items: readonly MoveUndoItem[],
    destinationFolderId: string | null
  ) => Promise<DriveMoveUndoOutcome>;
  undoTrash: (
    items: readonly UndoableEntityRef[]
  ) => Promise<DriveTrashUndoOutcome>;
  undoRename: (
    entity: UndoableEntityRef,
    previousName: string,
    expectedCurrentName: string
  ) => Promise<DriveRenameUndoOutcome>;
};

export type DriveUndoResult =
  | { status: 'empty' }
  | { status: 'busy' }
  | { status: 'undone'; action: DriveUndoAction }
  | { status: 'skipped'; action: DriveUndoAction }
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
      if (action.kind === 'move') {
        const outcome = await executors.undoMove(
          action.items,
          action.destinationFolderId
        );
        if (typeof outcome === 'boolean') {
          if (!outcome) {
            setStack((current) => pushUndoAction(current, action));
            return { status: 'failed', action };
          }
          return { status: 'undone', action };
        }
        if (outcome.skipped && outcome.failedItems.length === 0) {
          return { status: 'skipped', action };
        }
        if (outcome.failedItems.length > 0) {
          const retryAction: DriveUndoAction = {
            ...action,
            items: outcome.failedItems,
          };
          setStack((current) => pushUndoAction(current, retryAction));
          return { status: 'failed', action: retryAction };
        }
        return { status: 'undone', action };
      }

      if (action.kind === 'trash') {
        const outcome = await executors.undoTrash(action.items);
        if (typeof outcome === 'boolean') {
          if (!outcome) {
            setStack((current) => pushUndoAction(current, action));
            return { status: 'failed', action };
          }
          return { status: 'undone', action };
        }
        if (outcome.failedItems.length > 0) {
          const retryAction: DriveUndoAction = {
            ...action,
            items: outcome.failedItems,
          };
          setStack((current) => pushUndoAction(current, retryAction));
          return { status: 'failed', action: retryAction };
        }
        return { status: 'undone', action };
      }

      const outcome = await executors.undoRename(
        action.entity,
        action.previousName,
        action.nextName
      );
      if (outcome === 'skipped') {
        return { status: 'skipped', action };
      }
      if (!outcome) {
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
