import { debounce } from '@solid-primitives/scheduled';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { onCleanup, onMount } from 'solid-js';

/** Distance-only by default, with an optional hold delay for ordinary item drags. */
export function createDistancePointerSensor(
  distance: number,
  onCancel: () => void,
  options: { id?: string; manual?: boolean; activationDelay?: number } = {}
) {
  const context = useDragDropContext();
  if (!context)
    throw new Error('Distance pointer sensor requires DragDropProvider');
  const [state, actions] = context;
  const id = options.id ?? 'distance-pointer-sensor';
  let pendingId: string | number | undefined;
  let origin = { x: 0, y: 0 };
  let cancelled = false;
  let attached = false;
  const isActive = () => state.active.sensorId === id;
  const clearSelection = () => window.getSelection()?.removeAllRanges();

  const detach = () => {
    activateAfterDelay.clear();
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('pointercancel', cancelOnPointerCancel, true);
    document.removeEventListener('selectionchange', clearSelection);
    document.removeEventListener('keydown', cancelOnEscape, true);
    document.removeEventListener('visibilitychange', cancelWhenHidden);
    window.removeEventListener('blur', cancelOnBlur);
    attached = false;
    pendingId = undefined;
    cancelled = false;
  };

  const activate = () => {
    if (!attached || cancelled || pendingId === undefined) return;
    if (state.active.sensor && !isActive()) {
      detach();
      return;
    }
    if (isActive()) return;
    if (!state.draggables[pendingId]) {
      detach();
      return;
    }

    activateAfterDelay.clear();
    actions.sensorStart(id, origin);
    actions.dragStart(pendingId);
    clearSelection();
    document.addEventListener('selectionchange', clearSelection);
  };
  const activateAfterDelay = debounce(activate, options.activationDelay);

  const attach = (event: MouseEvent, draggableId: string | number) => {
    if (event.button !== 0 || attached || state.active.sensor) return;
    origin = { x: event.clientX, y: event.clientY };
    pendingId = draggableId;
    attached = true;
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('pointercancel', cancelOnPointerCancel, true);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    window.addEventListener('blur', cancelOnBlur);
    if (options.manual) {
      document.addEventListener('keydown', cancelOnEscape, true);
    }
    if (options.activationDelay !== undefined) activateAfterDelay();
  };

  const move = (event: MouseEvent) => {
    if ((event.buttons & 1) === 0) {
      cancel(true);
      return;
    }
    if (cancelled) return;

    const coordinates = { x: event.clientX, y: event.clientY };
    if (!state.active.sensor && pendingId !== undefined) {
      if (
        Math.hypot(coordinates.x - origin.x, coordinates.y - origin.y) >
        distance
      ) {
        activate();
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
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !cancel()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const cancelOnBlur = () => cancel(true);
  const cancelOnPointerCancel = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    cancel(true);
  };
  const cancelWhenHidden = () => {
    if (document.visibilityState === 'hidden') cancel(true);
  };

  onMount(() =>
    actions.addSensor({
      id,
      activators: options.manual ? {} : { mousedown: attach },
    })
  );
  onCleanup(() => {
    cancel(true);
    actions.removeSensor(id);
  });
  return { cancel, start: attach };
}
