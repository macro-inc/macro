import { hapticImpact } from '@core/mobile/haptics';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { onCleanup, onMount } from 'solid-js';

/** Dedicated handles drag after a small movement; the rest of each row scrolls. */
export function createDockTouchSensor(onCancel: () => void) {
  const context = useDragDropContext();
  if (!context) throw new Error('Dock touch sensor requires DragDropProvider');
  const [state, actions] = context;
  const id = 'dock-touch';
  let gesture:
    | {
        element: HTMLElement;
        draggableId: string;
        touchId: number;
        x: number;
        y: number;
      }
    | undefined;
  const active = () => state.active.sensorId === id;

  const finish = (cancelled: boolean) => {
    gesture?.element.removeAttribute('data-touch-pressed');
    gesture = undefined;
    if (!active()) return;
    if (cancelled) onCancel();
    if (state.active.draggable) actions.dragEnd();
    actions.sensorEnd();
  };
  const cancel = () => finish(true);
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) return cancel();
    const touch = Array.from(event.touches).find(
      (touch) => touch.identifier === gesture?.touchId
    );
    if (!touch) return cancel();
    // Reserve handle gestures for dragging, including movement below threshold.
    event.preventDefault();
    if (!active()) {
      if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) < 8)
        return;
      if (state.active.sensor) return cancel();
      actions.sensorStart(id, { x: gesture.x, y: gesture.y });
      actions.dragStart(gesture.draggableId);
      hapticImpact('light');
    }
    actions.sensorMove({ x: touch.clientX, y: touch.clientY });
  };
  const end = (event: TouchEvent) => {
    if (!gesture) return;
    event.preventDefault();
    finish(false);
  };
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !gesture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length > 1) cancel();
  };
  onMount(() => {
    actions.addSensor({ id, activators: {} });
    document.addEventListener('touchmove', move, {
      capture: true,
      passive: false,
    });
    document.addEventListener('touchend', end, {
      capture: true,
      passive: false,
    });
    document.addEventListener('touchcancel', cancel, true);
    document.addEventListener('touchstart', start, true);
    document.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
  });
  onCleanup(() => {
    cancel();
    actions.removeSensor(id);
    document.removeEventListener('touchmove', move, true);
    document.removeEventListener('touchend', end, true);
    document.removeEventListener('touchcancel', cancel, true);
    document.removeEventListener('touchstart', start, true);
    document.removeEventListener('keydown', cancelOnEscape, true);
    window.removeEventListener('blur', cancel);
  });

  return (element: HTMLElement, draggableId: string) => {
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1 || state.active.sensor) return;
      event.stopPropagation();
      event.preventDefault();
      const touch = event.touches[0];
      gesture = {
        element,
        draggableId,
        touchId: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
      };
      element.setAttribute('data-touch-pressed', '');
    };
    element.addEventListener('touchstart', begin, { passive: false });
    onCleanup(() => {
      if (gesture?.element === element) cancel();
      element.removeEventListener('touchstart', begin);
    });
  };
}
