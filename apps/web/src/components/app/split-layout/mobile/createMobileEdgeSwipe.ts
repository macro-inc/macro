/** Start inside the same left-edge zone used by the mobile pane stack. */
export const SWIPE_EDGE_THRESHOLD = 40;
const DIRECTION_SLOP = 8;
const VELOCITY_THRESHOLD = 0.3; // px/ms
const DISTANCE_THRESHOLD = 0.5; // fraction of the pane width

/** Recognizes a rightward edge swipe and leaves presentation to its host. */
export function createMobileEdgeSwipe(options: {
  enabled: () => boolean;
  onStart?: () => void;
  onMove?: (offset: number) => void;
  onEnd: (completed: boolean) => void;
}) {
  let tracking:
    | { id: number; x: number; y: number; time: number; width: number }
    | undefined;
  let dragging = false;
  let offset = 0;

  function reset() {
    tracking = undefined;
    dragging = false;
    offset = 0;
  }

  function finish(completed: boolean) {
    const wasDragging = dragging;
    reset();
    if (wasDragging) options.onEnd(completed);
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      finish(false);
      return false;
    }
    if (
      event.defaultPrevented ||
      !options.enabled() ||
      !(event.currentTarget instanceof Element)
    ) {
      return false;
    }
    const touch = event.touches[0];
    const frame = event.currentTarget.getBoundingClientRect();
    if (
      touch.clientX - frame.left > SWIPE_EDGE_THRESHOLD ||
      (event.target instanceof Element &&
        event.target.closest(
          'button, a, [role="button"], input, textarea, [contenteditable="true"]'
        ))
    ) {
      return false;
    }
    tracking = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
      width: frame.width,
    };
    return true;
  }

  function handleTouchMove(event: TouchEvent) {
    if (!tracking) return;
    const touch = event.touches[0];
    if (
      event.touches.length !== 1 ||
      touch.identifier !== tracking.id ||
      !options.enabled()
    ) {
      finish(false);
      return;
    }
    const dx = touch.clientX - tracking.x;
    if (!dragging) {
      const dy = Math.abs(touch.clientY - tracking.y);
      if (Math.max(Math.abs(dx), dy) < DIRECTION_SLOP) return;
      if (dx <= dy || event.defaultPrevented) {
        reset();
        return;
      }
      dragging = true;
      options.onStart?.();
    }
    if (event.cancelable) event.preventDefault();
    offset = Math.max(0, dx);
    options.onMove?.(offset);
  }

  function handleTouchEnd(event: TouchEvent) {
    if (!tracking) return;
    if (event.touches.length > 0) {
      finish(false);
      return;
    }
    const elapsed = event.timeStamp - tracking.time;
    const velocity = elapsed > 0 ? offset / elapsed : 0;
    finish(
      options.enabled() &&
        (offset > tracking.width * DISTANCE_THRESHOLD ||
          velocity > VELOCITY_THRESHOLD)
    );
  }

  return {
    reset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel: () => finish(false),
  };
}
