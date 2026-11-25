import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { onCleanup, onMount } from 'solid-js';

/** Own the entire mouse drag, including releases that never reach the document. */
export function createItemDragSensor(options: {
  move: (position: { x: number; y: number }) => void;
  clear: () => void;
}) {
  const context = useDragDropContext();
  if (!context) throw new Error('Item drag sensor requires DragDropProvider');
  const [state, actions] = context;
  const id = 'item-mouse-sensor';
  let pendingId: string | number | undefined;
  let origin = { x: 0, y: 0 };
  let timer: number | undefined;
  let pointerUpTimer: number | undefined;
  let attached = false;
  let pointerId: number | undefined;
  let captureNode: HTMLElement | undefined;
  let suppressedClickFrom: HTMLElement | undefined;
  const isActive = () => state.active.sensorId === id;
  const clearSelection = () => window.getSelection()?.removeAllRanges();

  const observePointerDown = (event: PointerEvent) => {
    if (attached || event.pointerType === 'touch' || event.button !== 0) return;
    suppressedClickFrom = undefined;
    pointerId = event.pointerId;
  };
  const observeMouseDown = (event: MouseEvent) => {
    if (!attached && event.button === 0) suppressedClickFrom = undefined;
  };
  const consumeDragClick = (event: MouseEvent) => {
    if (!suppressedClickFrom || event.detail === 0) return;
    if ('pointerType' in event && event.pointerType === 'touch') return;
    if (!event.composedPath().includes(suppressedClickFrom)) return;
    // Pointer capture routes the release click back to the source row. Consume
    // only that click, not keyboard activation or another pointer's click.
    suppressedClickFrom = undefined;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const cancelPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    if (pointerId !== undefined && event.pointerId !== pointerId) return;
    cancel();
  };
  const lostCapture = (event: PointerEvent) => {
    // Pointerup releases capture before the compatibility mouseup arrives.
    if (event.pointerId === pointerId && pointerUpTimer === undefined) cancel();
  };

  const detach = () => {
    window.clearTimeout(timer);
    window.clearTimeout(pointerUpTimer);
    timer = undefined;
    pointerUpTimer = undefined;
    pendingId = undefined;
    attached = false;
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('pointercancel', cancelPointer, true);
    window.removeEventListener('lostpointercapture', lostCapture, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('keydown', cancelOnEscape, true);
    document.removeEventListener('selectionchange', clearSelection);
    try {
      if (
        pointerId !== undefined &&
        captureNode?.hasPointerCapture(pointerId)
      ) {
        captureNode.releasePointerCapture(pointerId);
      }
    } catch {
      // The browser can retire the pointer before cancellation releases capture.
    }
    captureNode = undefined;
    pointerId = undefined;
  };

  const finish = (deliver: boolean) => {
    if (!attached) return;
    const active = isActive();
    if (active) suppressedClickFrom = state.active.draggable?.node;
    detach();
    try {
      if (!active) return;
      try {
        if (!deliver) {
          options.clear();
          actions.detectCollisions();
        }
      } finally {
        if (state.active.draggable) actions.dragEnd();
      }
    } finally {
      try {
        if (active) actions.sensorEnd();
      } finally {
        try {
          options.clear();
        } finally {
          if (active) {
            try {
              actions.clearOverlay();
            } finally {
              // DragOverlay also queues a setOverlay during start. Its end
              // callback can be skipped when another onDragEnd handler throws.
              queueMicrotask(() => {
                if (!state.active.draggable) actions.clearOverlay();
              });
            }
          }
        }
      }
    }
  };

  const cancel = () => finish(false);
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !attached) return;
    try {
      cancel();
    } finally {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const activate = () => {
    timer = undefined;
    if (!attached || pendingId === undefined) return;
    if (state.active.sensor) {
      if (!isActive()) finish(false);
      return;
    }
    try {
      actions.sensorStart(id, origin);
      actions.dragStart(pendingId);
      suppressedClickFrom = state.active.draggable?.node;
      // Capture only after activation, so normal clicks keep their native target.
      // The release then reaches us even outside the window or over an iframe.
      const node = state.active.draggable?.node;
      if (pointerId !== undefined && node?.setPointerCapture) {
        try {
          node.setPointerCapture(pointerId);
          captureNode = node;
        } catch {
          // The pointer ended before the delayed activation could capture it.
          cancel();
          return;
        }
      }
      clearSelection();
      document.addEventListener('selectionchange', clearSelection);
    } catch (error) {
      cancel();
      throw error;
    }
  };
  const move = (event: MouseEvent) => {
    if (!attached) return;
    // Real mousemove events report held buttons. Older synthetic callers omit
    // buttons on the first move, so only use that check before activation for
    // trusted input.
    if (event.buttons === 0 && (isActive() || event.isTrusted)) {
      cancel();
      return;
    }
    const position = { x: event.clientX, y: event.clientY };
    try {
      options.move(position);
      if (
        !state.active.sensor &&
        Math.hypot(position.x - origin.x, position.y - origin.y) > 10
      )
        activate();
      if (isActive()) {
        event.preventDefault();
        actions.sensorMove(position);
      }
    } catch (error) {
      cancel();
      throw error;
    }
  };
  const up = (event: MouseEvent) => {
    if (!attached || event.button !== 0) return;
    if (isActive()) event.preventDefault();
    try {
      options.move({ x: event.clientX, y: event.clientY });
      if (isActive()) actions.detectCollisions();
      finish(true);
    } catch (error) {
      cancel();
      throw error;
    }
  };
  const pointerUp = (event: PointerEvent) => {
    if (!attached || event.pointerType === 'touch' || event.button !== 0)
      return;
    if (pointerId !== undefined && event.pointerId !== pointerId) return;
    // A normal mouseup follows pointerup; keep the drag through intervening
    // scroll collision checks, but finish if mouseup never arrives.
    window.clearTimeout(pointerUpTimer);
    pointerUpTimer = window.setTimeout(() => {
      try {
        options.move({ x: event.clientX, y: event.clientY });
        if (isActive()) actions.detectCollisions();
        finish(true);
      } catch (error) {
        cancel();
        throw error;
      }
    }, 0);
  };
  const attach = (event: MouseEvent, draggableId: string | number) => {
    if (event.button !== 0 || attached || state.active.sensor) return;
    suppressedClickFrom = undefined;
    origin = { x: event.clientX, y: event.clientY };
    pendingId = draggableId;
    attached = true;
    try {
      options.move(origin);
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
      window.addEventListener('pointerup', pointerUp, true);
      window.addEventListener('pointercancel', cancelPointer, true);
      window.addEventListener('lostpointercapture', lostCapture, true);
      window.addEventListener('blur', cancel);
      document.addEventListener('keydown', cancelOnEscape, true);
      timer = window.setTimeout(activate, 250);
    } catch (error) {
      cancel();
      throw error;
    }
  };

  onMount(() => {
    window.addEventListener('pointerdown', observePointerDown, true);
    window.addEventListener('mousedown', observeMouseDown, true);
    window.addEventListener('click', consumeDragClick, true);
    actions.addSensor({ id, activators: { mousedown: attach } });
  });
  onCleanup(() => {
    try {
      cancel();
    } finally {
      window.removeEventListener('pointerdown', observePointerDown, true);
      window.removeEventListener('mousedown', observeMouseDown, true);
      window.removeEventListener('click', consumeDragClick, true);
      actions.removeSensor(id);
    }
  });
}
