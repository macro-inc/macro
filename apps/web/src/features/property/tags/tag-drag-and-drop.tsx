import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { type Accessor, createUniqueId } from 'solid-js';
import type { TreeTag } from './core/tag-tree';

/**
 * Pointer collisions only match a droppable in the draggable's scope, so tag
 * drags never land on entity drop zones and entity drags skip tag targets.
 */
const TAG_DND_SCOPE = 'entity-tag';

export type TagDragData = {
  dragType: 'tag';
  dndScope: typeof TAG_DND_SCOPE;
  name: string;
  color?: string;
};

type TagDropData = {
  dragType: 'tag-target';
  dndScope: typeof TAG_DND_SCOPE;
  onDropTag: (tag: TreeTag) => void;
  isDropTargetDisabled: () => boolean;
};

function isTagDropData(data: unknown): data is TagDropData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'dragType' in data &&
    data.dragType === 'tag-target'
  );
}

/**
 * Makes a tag draggable onto any `createTagDropTarget` row. Returns undefined
 * outside the app's DragDropProvider, where there is nothing to drop onto.
 */
export function createTagDraggable(
  tag: TreeTag
): ((element: HTMLElement) => void) | undefined {
  const context = useDragDropContext();
  if (!context) return undefined;

  const id = `tag-drag:${createUniqueId()}`;
  const draggable = createDraggable(id, {
    dragType: 'tag',
    dndScope: TAG_DND_SCOPE,
    name: tag.label,
    color: tag.color,
  } satisfies TagDragData);

  // Registered per draggable (not per target) so each drop applies once.
  context[1].onDragEnd(({ draggable: dragged, droppable }) => {
    if (dragged.id !== id || !droppable) return;
    if (!isTagDropData(droppable.data)) return;
    if (droppable.data.isDropTargetDisabled()) return;
    droppable.data.onDropTag(tag);
  });

  return draggable;
}

/** Registers an element as a place to drop a dragged tag. */
export function createTagDropTarget(options: {
  onDropTag: (tag: TreeTag) => void;
  disabled?: Accessor<boolean>;
}):
  | { ref: (element: HTMLElement) => void; isOver: Accessor<boolean> }
  | undefined {
  if (!useDragDropContext()) return undefined;

  const droppable = createDroppable(`tag-drop:${createUniqueId()}`, {
    dragType: 'tag-target',
    dndScope: TAG_DND_SCOPE,
    onDropTag: options.onDropTag,
    isDropTargetDisabled: () => options.disabled?.() ?? false,
  } satisfies TagDropData);

  return {
    ref: droppable.ref,
    isOver: () => droppable.isActiveDroppable,
  };
}
