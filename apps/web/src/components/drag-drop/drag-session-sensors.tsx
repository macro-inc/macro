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
  nestedScroll?: { viewportSelector: string; horizontalOutside: boolean };
  onCancel: () => void;
}) {
  const context = useDragDropContext();
  if (!context) throw new Error('DragSessionSensors requires DragDropProvider');
  const [state, actions] = context;
  createDragAutoScroll({
    getViewport: props.getViewport,
    axis: props.axis,
    nestedScroll: props.nestedScroll,
  });
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
    if (!state.active.draggable) return;

    const viewport = props.getViewport();
    if (event.target === viewport) {
      actions.detectCollisions();
      return;
    }

    if (!props.nestedScroll || !(event.target instanceof Element)) return;
    if (!viewport?.contains(event.target)) return;
    if (!event.target.matches(props.nestedScroll.viewportSelector)) return;

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
