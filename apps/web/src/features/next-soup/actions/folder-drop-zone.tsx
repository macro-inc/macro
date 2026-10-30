import {
  entitiesToMove,
  indexFolders,
} from '@app/features/entity/bulk-edit/folder-destinations';
import { createMoveEntitiesToFolder } from '@app/features/entity/bulk-edit/move-entities-to-folder';
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
  type ParentProps,
  Show,
} from 'solid-js';
import { makeMoveToProjectAction } from './make-move-to-project-action';

/**
 * Registers an element showing a folder as a place to drop dragged rows, under
 * the same rules as Move to folder. A row dragged within its own split is not
 * a move: the split already shows where it lives.
 */
function createFolderDropTarget(options: {
  folderId: Accessor<string | undefined>;
  splitId: Accessor<string | undefined>;
}) {
  const context = useDragDropContext();
  if (!context) return undefined;
  const [state, { onDragEnd }] = context;

  const folderList = createFolderList();
  const moveEntities = createMoveEntitiesToFolder('folder_drop');
  const moveToProjectAction = makeMoveToProjectAction({ userId: useUserId() });
  const folders = createMemo(() => indexFolders(folderList.folders()));

  const droppableEntities = (data: unknown): EntityData[] => {
    const folderId = options.folderId();
    if (!folderId || !isEntityDragData(data)) return [];
    if (data.splitId === options.splitId()) return [];
    const dragged = data.selection?.entities() ?? [data];
    if (!dragged.every(moveToProjectAction.canExecute)) return [];
    return entitiesToMove(dragged, folderId, folders());
  };

  const droppableId = `folder-drop:${createUniqueId()}`;
  const droppable = createDroppable(droppableId, {
    isDropTargetDisabled: () =>
      droppableEntities(state.active.draggable?.data).length === 0,
  });

  const move = async (entities: EntityData[], folderId: string) => {
    const name = folders().get(folderId)?.name ?? folderId;
    try {
      await moveEntities(entities, { id: folderId, name });
      toast.success(
        entities.length > 1
          ? t('entityActions.toastMovedCount', { count: entities.length })
          : t('entityActions.toastMovedToFolder')
      );
    } catch {
      toast.failure(t('entityActions.toastMoveToFolderFailed'));
    }
  };

  onDragEnd(({ draggable, droppable: target }) => {
    const folderId = options.folderId();
    if (target?.id !== droppableId || !folderId) return;
    const entities = droppableEntities(draggable.data);
    if (entities.length === 0) return;
    if (isEntityDragData(draggable.data)) draggable.data.selection?.clear();
    fireAndForget(move(entities, folderId), 'folder-drop');
  });

  return {
    ref: droppable.ref,
    count: () => droppableEntities(state.active.draggable?.data).length,
    isOver: () => droppable.isActiveDroppable,
  };
}

/** The body of a split showing a folder: dragged rows dropped here move into it. */
export function FolderDropZone(
  props: ParentProps<{ folderId: string | undefined }>
) {
  const panel = useSplitPanel();
  const target = createFolderDropTarget({
    folderId: () => props.folderId,
    splitId: () => panel?.handle.id,
  });

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
