import { fireAndForget } from '@core/util/fireAndForget';
import { isEntityDragData } from '@entity/types/drag';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createUniqueId, onCleanup } from 'solid-js';
import { getEntityType } from '../../editors/selectors/entityUtils';
import type { Property } from '../../types';

/** Apply the entity picker's type restrictions to an app-item drag. */
export function getCollectionDropReference(
  property: Property,
  data: unknown,
  selfId: string,
  selfType: EntityType
): EntityReference | undefined {
  if (
    property.valueType !== 'ENTITY' ||
    !property.isMultiSelect ||
    property.isMetadata ||
    !isEntityDragData(data)
  ) {
    return;
  }

  const entityType = getEntityType({ kind: 'entity', id: data.id, data });
  if (!entityType) return;
  if (data.id === selfId && entityType === selfType) return;
  if (property.specificEntityType && property.specificEntityType !== entityType) {
    return;
  }
  if (property.value?.some((reference) => reference.entity_id === data.id)) {
    return;
  }

  return { entity_id: data.id, entity_type: entityType };
}

/** One target covers the compact collection and its expanded drag feedback. */
export function createEntityCollectionDropTarget(options: {
  property: Accessor<Property>;
  selfId: Accessor<string>;
  selfType: Accessor<EntityType>;
  disabled: Accessor<boolean>;
  onDrop: (reference: EntityReference) => Promise<void>;
}) {
  const context = useDragDropContext();
  if (!context) return;

  const [state, actions] = context;
  const id = `property-collection:${createUniqueId()}`;
  const referenceFor = (data: unknown) =>
    getCollectionDropReference(
      options.property(),
      data,
      options.selfId(),
      options.selfType()
    );
  const isDragging = () => isEntityDragData(state.active.draggable?.data);
  const canDrop = () =>
    !options.disabled() && Boolean(referenceFor(state.active.draggable?.data));
  // Rejected targets stay disabled for drops but still need local hover feedback.
  const isPointerOver = () => {
    if (!isDragging()) return false;
    const pointer = state.active.sensor?.coordinates.current;
    const bounds = state.droppables[id]?.layout;
    if (!pointer || !bounds) return false;
    return (
      pointer.x >= bounds.left &&
      pointer.x <= bounds.right &&
      pointer.y >= bounds.top &&
      pointer.y <= bounds.bottom
    );
  };
  const droppable = createDroppable(id, {
    type: 'property-collection',
    isDropTargetDisabled: () => !canDrop(),
  });
  // Expanded dropzones move other targets, so refresh collision bounds as they resize.
  const resizeObserver = new ResizeObserver(() => {
    if (!isDragging()) return;
    actions.recomputeLayouts();
    actions.detectCollisions();
  });
  onCleanup(() => resizeObserver.disconnect());

  actions.onDragEnd(({ draggable, droppable: target }) => {
    if (target?.id !== id || options.disabled()) return;
    const reference = referenceFor(draggable.data);
    if (!reference) return;
    fireAndForget(options.onDrop(reference), 'property-collection-drop');
  });

  return {
    ref: (element: HTMLElement) => {
      droppable.ref(element);
      resizeObserver.observe(element);
    },
    isDragging,
    canDrop,
    isPointerOver,
    isRejected: () => isDragging() && !canDrop(),
    isOver: () => state.active.droppable?.id === id && canDrop(),
  };
}
