import {
  entitiesToMove,
  indexFolders,
} from '@app/features/entity/bulk-edit/folder-destinations';
import { createMoveEntitiesToFolder } from '@app/features/entity/bulk-edit/move-entities-to-folder';
import { toastMovedToFolder } from '@app/features/entity/bulk-edit/moved-to-folder-toast';
import { t } from '@app/lib/i18n';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { type EntityData, isEntityDragData } from '@entity';
import { createFolderList } from '@queries/storage/folder-list';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createMemo,
  createUniqueId,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { makeMoveToProjectAction } from './make-move-to-project-action';

type FolderDropTarget = {
  ref: (element: HTMLElement) => void;
  count: Accessor<number>;
  isOver: Accessor<boolean>;
};

export type CreateFolderDropTarget = (
  folderId: Accessor<string | undefined>
) => FolderDropTarget;

/**
 * Drop handling for one surface's folders, under the same rules as Move to
 * folder. Its targets share one folder list and mutation, so a long folder tree
 * costs a droppable per row. Returns undefined outside the app's
 * DragDropProvider, where there is nothing to drag.
 *
 * A surface showing a folder's contents passes its split as `ownSplitId`: a row
 * dragged within that split is not a move, as the split already shows where it
 * lives.
 */
export function createFolderDropTargets(
  options: { ownSplitId?: Accessor<string | undefined> } = {}
): CreateFolderDropTarget | undefined {
  const context = useDragDropContext();
  if (!context) return undefined;
  const [state, { onDragEnd }] = context;

  const folderList = createFolderList();
  const moveEntities = createMoveEntitiesToFolder('folder_drop');
  const moveToProjectAction = makeMoveToProjectAction({ userId: useUserId() });
  const folders = createMemo(() => indexFolders(folderList.folders()));
  const targets = new Map<string | number, Accessor<string | undefined>>();

  const droppableEntities = (
    data: unknown,
    folderId: string | undefined
  ): EntityData[] => {
    if (!folderId || !isEntityDragData(data)) return [];
    if (data.operation() !== 'move') return [];
    const ownSplitId = options.ownSplitId?.();
    if (ownSplitId && data.splitId === ownSplitId) return [];
    const dragged = data.selection?.entities() ?? [data];
    if (!dragged.every(moveToProjectAction.canExecute)) return [];
    return entitiesToMove(dragged, folderId, folders());
  };

  const move = async (
    entities: EntityData[],
    folderId: string,
    clearSelection: () => void
  ) => {
    const name = folders().get(folderId)?.name ?? folderId;
    try {
      await moveEntities(entities, { id: folderId, name });
      clearSelection();
      toastMovedToFolder(entities.length, folderId);
    } catch {
      toast.failure(t('entityActions.toastMoveToFolderFailed'));
    }
  };

  onDragEnd(({ draggable, droppable }) => {
    const data = draggable.data;
    const folderId = droppable && targets.get(droppable.id)?.();
    if (!folderId || !isEntityDragData(data)) return;
    const entities = droppableEntities(data, folderId);
    if (entities.length === 0) return;

    // Read now: the moved rows can leave the list before the server answers.
    const held = new Set(data.selection?.selected().map(({ id }) => id));
    const clearSelection = () => {
      const rowsAdded = data.selection
        ?.selected()
        .some(({ id }) => !held.has(id));
      if (held.has(data.id) && !rowsAdded) data.selection?.clear();
    };
    fireAndForget(move(entities, folderId, clearSelection), 'folder-drop');
  });

  return (folderId) => {
    const count = () =>
      droppableEntities(state.active.draggable?.data, folderId()).length;
    const droppableId = `folder-drop:${createUniqueId()}`;
    const droppable = createDroppable(droppableId, {
      isDropTargetDisabled: () => count() === 0,
    });
    targets.set(droppableId, folderId);
    onCleanup(() => targets.delete(droppableId));

    return {
      ref: droppable.ref,
      count,
      isOver: () => droppable.isActiveDroppable && count() > 0,
    };
  };
}

/** The body of a split showing a folder: dragged rows dropped here move into it. */
export function FolderDropZone(
  props: ParentProps<{ folderId: string | undefined }>
) {
  const panel = useSplitPanel();
  const createTarget = createFolderDropTargets({
    ownSplitId: () => panel?.handle.id,
  });
  const target = createTarget?.(() => props.folderId);

  return (
    <div
      ref={(element) => target?.ref(element)}
      class="relative flex size-full min-h-0 min-w-0 flex-col"
    >
      <Show when={target?.isOver()}>
        <FileDropOverlay>
          {t('entityActions.dropIntoFolder', { count: target?.count() ?? 0 })}
        </FileDropOverlay>
      </Show>
      {props.children}
    </div>
  );
}
