import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { onCleanup, onMount } from 'solid-js';

/** The stock pointer sensor activates after 250ms or 10px. This one has no timer. */
export function createDistancePointerSensor(
  distance: number,
  onCancel: () => void
) {
  const context = useDragDropContext();
  if (!context)
    throw new Error('Distance pointer sensor requires DragDropProvider');
  const [state, actions] = context;
  const id = 'distance-pointer-sensor';
  let pendingId: string | number | undefined;
  let origin = { x: 0, y: 0 };
  let cancelled = false;
  let attached = false;
  const isActive = () => state.active.sensorId === id;
  const clearSelection = () => window.getSelection()?.removeAllRanges();

  const detach = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('selectionchange', clearSelection);
    attached = false;
    pendingId = undefined;
    cancelled = false;
  };
  const attach = (event: MouseEvent, draggableId: string | number) => {
    if (event.button !== 0 || attached) return;
    origin = { x: event.clientX, y: event.clientY };
    pendingId = draggableId;
    attached = true;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const move = (event: MouseEvent) => {
    if (cancelled) return;
    const coordinates = { x: event.clientX, y: event.clientY };
    if (!state.active.sensor && pendingId !== undefined) {
      if (
        Math.hypot(coordinates.x - origin.x, coordinates.y - origin.y) >
        distance
      ) {
        actions.sensorStart(id, origin);
        actions.dragStart(pendingId);
        clearSelection();
        document.addEventListener('selectionchange', clearSelection);
      }
    } else if (state.active.sensor && !isActive()) {
      detach();
      return;
    }
    if (isActive()) {
      event.preventDefault();
      actions.sensorMove(coordinates);
    }
  };
  const up = (event: MouseEvent) => {
    const active = isActive();
    detach();
    if (active) {
      event.preventDefault();
      if (state.active.draggable) actions.dragEnd();
      actions.sensorEnd();
    }
  };
  /** Escape keeps the active sensor claimed until mouseup. Blur releases it immediately. */
  const cancel = (release = false) => {
    if (!attached) return false;
    const active = isActive();
    if (active) {
      const firstCancellation = !cancelled;
      cancelled = true;
      if (firstCancellation && state.active.draggable) {
        onCancel();
        actions.dragEnd();
      }
      if (release) {
        detach();
        actions.sensorEnd();
      }
    } else {
      detach();
    }
    return true;
  };
  onMount(() => actions.addSensor({ id, activators: { mousedown: attach } }));
  onCleanup(() => {
    cancel(true);
    actions.removeSensor(id);
  });
  return { cancel };
}
