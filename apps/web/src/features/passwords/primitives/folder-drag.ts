import { fireAndForget } from '@core/util/fireAndForget';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
} from 'solid-js';
import type { PasswordScope } from '../context/passwords-context';
import {
  folderSubtree,
  type PasswordFolder,
  type PasswordItem,
} from '../core/types';

/** Passwords destinations use Drive's tree slot, never Drive entity mutations. */
export function createPasswordFolderDrag(options: {
  scope: PasswordScope;
  folders: Accessor<PasswordFolder[]>;
  items: Accessor<
    readonly Pick<PasswordItem, 'id' | 'name' | 'folderId' | 'canManage'>[]
  >;
  moveFolder: (
    id: string,
    parentId: string | null
  ) => Promise<boolean | undefined>;
  moveItem: (id: string, parentId: string | null) => Promise<void>;
}) {
  const context = useDragDropContext();
  if (!context) return undefined;
  const [state, actions] = context;
  const owner = Symbol('passwords-drag');
  const [moving, setMoving] = createSignal(false);
  const targets = new Map<
    string | number,
    Accessor<string | null | undefined>
  >();
  let cancelled = false;
  let dragged: string | undefined;

  const own = (
    data: unknown
  ): data is {
    dragType: 'passwords';
    owner: symbol;
    resource: 'folder' | 'item';
    id: string;
  } =>
    typeof data === 'object' &&
    data !== null &&
    'dragType' in data &&
    data.dragType === 'passwords' &&
    'owner' in data &&
    data.owner === owner &&
    'resource' in data &&
    (data.resource === 'folder' || data.resource === 'item') &&
    'id' in data &&
    typeof data.id === 'string';

  function canDrop(data: unknown, parentId: string | null | undefined) {
    if (parentId === undefined) return false;
    if (!own(data) || !options.scope.isCurrent() || moving()) return false;
    const folders = options.folders();
    if (parentId !== null && !folders.some((folder) => folder.id === parentId))
      return false;
    if (data.resource === 'folder') {
      const folder = folders.find((folder) => folder.id === data.id);
      return (
        !!folder &&
        (folder.parentId ?? null) !== parentId &&
        (parentId === null || !folderSubtree(folders, folder.id).has(parentId))
      );
    }
    const item = options.items().find((item) => item.id === data.id);
    return !!item?.canManage && item.folderId !== parentId;
  }

  actions.onDragStart(({ draggable }) => {
    if (!own(draggable.data)) return;
    cancelled = false;
    dragged = draggable.id.toString();
  });
  async function move(data: unknown, parentId: string | null) {
    if (!own(data) || !canDrop(data, parentId)) return;
    setMoving(true);
    try {
      if (data.resource === 'folder')
        await options.moveFolder(data.id, parentId);
      else await options.moveItem(data.id, parentId);
    } finally {
      setMoving(false);
    }
  }
  actions.onDragEnd(({ draggable, droppable }) => {
    const target = droppable && targets.get(droppable.id);
    const parentId = target?.();
    if (
      cancelled ||
      parentId === undefined ||
      !canDrop(draggable.data, parentId)
    )
      return;
    fireAndForget(move(draggable.data, parentId), 'passwords-folder-drop');
  });

  onCleanup(() => {
    if (!own(state.active.draggable?.data)) return;
    cancelled = true;
    actions.dragEnd();
  });

  return {
    isDragging: () =>
      own(state.active.draggable?.data) && options.scope.isCurrent(),
    cancel: () => {
      cancelled = true;
    },
    source(
      resource: 'folder' | 'item',
      id: string,
      overlayIcon: () => JSX.Element
    ) {
      const key = `passwords-source:${createUniqueId()}`;
      const name = () =>
        (resource === 'folder' ? options.folders() : options.items()).find(
          (entry) => entry.id === id
        )?.name ?? '';
      const draggable = createDraggable(key, {
        dragType: 'passwords',
        owner,
        resource,
        id,
        overlayIcon,
        overlayContent: name,
      });
      return {
        ref: draggable.ref,
        onMouseDown(event: MouseEvent) {
          dragged = undefined;
          if (event.button !== 0 || moving() || !options.scope.isCurrent())
            return;
          if (
            resource === 'item' &&
            !options.items().find((item) => item.id === id)?.canManage
          )
            return;
          if (
            !(event.currentTarget instanceof Element) ||
            !(event.target instanceof Element)
          )
            return;
          // Portal/menu presses and disclosure/name controls never start a drag.
          if (!event.currentTarget.contains(event.target)) return;
          const control = event.target.closest(
            'input,textarea,select,[contenteditable],[role="menuitem"],[aria-expanded]'
          );
          if (control && event.currentTarget.contains(control)) return;
          draggable.dragActivators.onmousedown?.(event);
        },
        onKeyDown(event: KeyboardEvent) {
          if (event.key === 'Enter' || event.key === ' ') dragged = undefined;
        },
        onClickCapture(event: MouseEvent) {
          if (dragged !== key) return;
          dragged = undefined;
          event.preventDefault();
          event.stopPropagation();
        },
      };
    },
    target(parentId: Accessor<string | null | undefined>) {
      const key = `passwords-target:${createUniqueId()}`;
      const valid = () => canDrop(state.active.draggable?.data, parentId());
      const droppable = createDroppable(key, {
        isDropTargetDisabled: () => !valid(),
      });
      targets.set(key, parentId);
      onCleanup(() => targets.delete(key));
      return {
        ref: droppable.ref,
        count: () => (valid() ? 1 : 0),
        isOver: () => droppable.isActiveDroppable && valid(),
      };
    },
  };
}

export type PasswordFolderDrag = ReturnType<typeof createPasswordFolderDrag>;
export type PasswordDragSource = ReturnType<
  NonNullable<PasswordFolderDrag>['source']
>;
