/** Start inside the same left-edge zone used by the mobile pane stack. */
export const SWIPE_EDGE_THRESHOLD = 40;
const DIRECTION_SLOP = 8;
const VELOCITY_THRESHOLD = 0.3; // px/ms
const DISTANCE_THRESHOLD = 0.5; // fraction of the pane width
/** How far back from the release the finger's velocity is measured. */
const VELOCITY_WINDOW_MS = 100;

type TouchSample = { x: number; time: number };

/**
 * The finger's horizontal velocity at release, in px/ms, from the samples in
 * the last `VELOCITY_WINDOW_MS`. A finger that rested before lifting has no
 * recent samples and so no velocity.
 */
function releaseVelocity(samples: readonly TouchSample[], endTime: number) {
  const recent = samples.filter(
    (sample) => endTime - sample.time <= VELOCITY_WINDOW_MS
  );
  const first = recent.at(0);
  const last = recent.at(-1);
  if (!first || !last || last.time <= first.time) return 0;

  return (last.x - first.x) / (last.time - first.time);
}

/** Recognizes a rightward edge swipe and leaves presentation to its host. */
export function createMobileEdgeSwipe(options: {
  enabled: () => boolean;
  onStart?: () => void;
  onMove?: (offset: number) => void;
  onEnd: (completed: boolean) => void;
}) {
  let tracking: { id: number; x: number; y: number; width: number } | undefined;
  let samples: TouchSample[] = [];
  let dragging = false;
  let offset = 0;

  function reset() {
    tracking = undefined;
    samples = [];
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
      width: frame.width,
    };
    samples = [{ x: touch.clientX, time: event.timeStamp }];
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

    // Keep only the samples the release velocity can still use.
    samples = samples.filter(
      (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS
    );
    samples.push({ x: touch.clientX, time: event.timeStamp });

    offset = Math.max(0, dx);
    options.onMove?.(offset);
  }

  /**
   * Like UIKit's back swipe, a flick decides by its direction: toward the
   * right completes and toward the left cancels, however far the pane has
   * moved. A slow release completes past half the width.
   */
  function handleTouchEnd(event: TouchEvent) {
    if (!tracking) return;
    if (event.touches.length > 0) {
      finish(false);
      return;
    }
    const velocity = releaseVelocity(samples, event.timeStamp);

    let completed: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      completed = true;
    } else if (velocity < -VELOCITY_THRESHOLD) {
      completed = false;
    } else {
      completed = offset > tracking.width * DISTANCE_THRESHOLD;
    }

    finish(options.enabled() && completed);
  }

  return {
    reset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel: () => finish(false),
  };
}
