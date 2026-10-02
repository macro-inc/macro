import { useDragOperation } from '@components/app/ItemDragAndDrop';
import { createSubRoot } from '@solid-primitives/rootless';
import { createDraggable } from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createEffect,
  createUniqueId,
  getOwner,
  mergeProps,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EntityDragData } from '../types/drag';
import type { EntityData } from '../types/entity';

export function createEntityDraggable(options: {
  entity: EntityData;
  splitId?: string;
  /** Opt-in by the owning view; legacy rows register eagerly. */
  deferUntilInteraction?: Accessor<boolean>;
}): (element: HTMLElement) => void {
  const { isAltKey } = useDragOperation();
  const draggableId = `${options.entity.id}-${options.splitId ?? createUniqueId()}`;

  const create = () => {
    // Rows now survive entity updates. Keep the payload reactive without
    // re-registering the draggable (which measures layout). Project the fields
    // rather than forwarding the source store's internal symbols into DnD's store.
    const dragData: EntityDragData = mergeProps(() => ({ ...options.entity }), {
      dragType: 'entity' as const,
      splitId: options.splitId,
      operation: () => (isAltKey() ? 'copy' : 'move'),
    });
    return createDraggable(draggableId, dragData);
  };

  if (
    !options.deferUntilInteraction ||
    !untrack(options.deferUntilInteraction)
  ) {
    return create();
  }

  const owner = getOwner();
  return (element) => {
    let initialized = false;
    let disposed = false;
    const initialize = () => {
      if (initialized || disposed) return;
      initialized = true;
      createSubRoot(() => create()(element), owner);
    };
    // Register before the sensor's bubbling mousedown listener. pointerdown
    // prepares real mouse input; mousedown also handles synthesized input.
    const onPress = (event: MouseEvent) => {
      if (event.button === 0) initialize();
    };
    element.addEventListener('pointerdown', onPress, true);
    element.addEventListener('mousedown', onPress, true);
    createEffect(() => {
      // A live transport fallback must restore eager legacy behavior.
      if (!options.deferUntilInteraction?.()) untrack(initialize);
    });
    onCleanup(() => {
      disposed = true;
      element.removeEventListener('pointerdown', onPress, true);
      element.removeEventListener('mousedown', onPress, true);
    });
  };
}
