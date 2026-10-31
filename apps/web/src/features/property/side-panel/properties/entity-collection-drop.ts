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
  if (
    property.specificEntityType &&
    property.specificEntityType !== entityType
  ) {
    return;
  }
  if (property.value?.some((reference) => reference.entity_id === data.id)) {
    return;
  }

  return { entity_id: data.id, entity_type: entityType };
}

/** One target covers the property label, values, and expanded drag feedback. */
export function createEntityCollectionDropTarget(options: {
  property: Accessor<Property>;
  selfId: Accessor<string>;
  selfType: Accessor<EntityType>;
  disabled: Accessor<boolean>;
  onDrop: (reference: EntityReference, name: string) => Promise<void>;
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
    if (!isEntityDragData(draggable.data)) return;
    const reference = referenceFor(draggable.data);
    if (!reference) return;
    fireAndForget(
      options.onDrop(reference, draggable.data.name),
      'property-collection-drop'
    );
  });

  return {
    ref: (element: HTMLElement) => {
      droppable.ref(element);
      resizeObserver.observe(element);
    },
    isDragging,
    canDrop,
    isOver: () => state.active.droppable?.id === id && canDrop(),
  };
}
