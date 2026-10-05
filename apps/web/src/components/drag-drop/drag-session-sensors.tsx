import { DragDropSensors, useDragDropContext } from '@thisbeyond/solid-dnd';
import { onCleanup } from 'solid-js';
import { createDragAutoScroll } from './create-drag-auto-scroll';

/**
 * Pointer sensors plus what every drag surface needs around them: auto-scroll
 * near the viewport's edges, Escape and window blur cancel, and drop targets
 * measured again as the viewport scrolls.
 */
export function DragSessionSensors(props: {
  getViewport: () => HTMLElement | undefined;
  axis: 'x' | 'both';
  onCancel: () => void;
}) {
  const context = useDragDropContext();
  if (!context) throw new Error('DragSessionSensors requires DragDropProvider');
  const [state, actions] = context;
  createDragAutoScroll({ getViewport: props.getViewport, axis: props.axis });
  const cancelDrag = () => {
    if (!state.active.draggable) return;
    props.onCancel();
    // Keep the sensor until mouseup so its next mousemove cannot restart a drag.
    actions.dragEnd();
  };
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !state.active.draggable) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  };
  const updateDrop = (event: Event) => {
    if (event.target === props.getViewport() && state.active.draggable)
      actions.detectCollisions();
  };
  document.addEventListener('keydown', cancelOnEscape, true);
  document.addEventListener('scroll', updateDrop, true);
  window.addEventListener('blur', cancelDrag);
  onCleanup(() => {
    document.removeEventListener('keydown', cancelOnEscape, true);
    document.removeEventListener('scroll', updateDrop, true);
    window.removeEventListener('blur', cancelDrag);
  });
  return <DragDropSensors />;
}
