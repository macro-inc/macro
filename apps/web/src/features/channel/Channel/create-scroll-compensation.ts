const SCROLL_IDLE_MS = 150;

type ScrollCompensationOptions = {
  getElement: () => HTMLElement | undefined;
  setAdjustment: (adjustment: number) => void;
  writeOffset: (offset: number) => void;
};

/**
 * Keeps a virtual list's logical offset separate from native gesture scrolling.
 * Rows subtract the adjustment from their positions until the gesture settles.
 */
export function createScrollCompensation(options: ScrollCompensationOptions) {
  let adjustment = 0;
  let reportedOffset: number | undefined;
  let active = false;
  const touchTargets = new Set<EventTarget>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const finish = () => {
    clearTimer();
    active = false;
    const element = options.getElement();
    const offset = (element?.scrollTop ?? 0) + adjustment;
    const needsWrite = adjustment !== 0 && element?.isConnected;
    adjustment = 0;
    options.setAdjustment(0);
    if (needsWrite) options.writeOffset(offset);
  };

  const scheduleFinish = () => {
    clearTimer();
    if (touchTargets.size > 0) return;
    const scheduledOffset = options.getElement()?.scrollTop;
    timer = setTimeout(() => {
      const element = options.getElement();
      // WebKit drops a scrollTop write while native momentum is still moving,
      // jumping the list by the whole adjustment, and a busy main thread can
      // delay scroll events past the idle period. Commit only once the offset
      // has also held still. Rubber-banding retries here without a scroll event.
      if (
        element &&
        (element.scrollTop !== scheduledOffset ||
          element.scrollTop < 0 ||
          element.scrollTop > element.scrollHeight - element.clientHeight)
      ) {
        scheduleFinish();
        return;
      }
      finish();
    }, SCROLL_IDLE_MS);
  };

  const releaseTouchTargets = () => {
    for (const target of touchTargets) {
      target.removeEventListener('touchend', onTouchEnd);
      target.removeEventListener('touchcancel', onTouchEnd);
    }
    touchTargets.clear();
  };
  const onTouchEnd = (event: Event) => {
    if ((event as TouchEvent).touches.length > 0) return;
    releaseTouchTargets();
    if (active) scheduleFinish();
  };

  return {
    onTouchStart: (event: TouchEvent) => {
      active = true;
      clearTimer();
      // Touch events retain their original target even after a virtual row
      // unmounts. Listen there so touchend/cancel cannot strand compensation.
      if (event.target) {
        touchTargets.add(event.target);
        event.target.addEventListener('touchend', onTouchEnd, {
          passive: true,
        });
        event.target.addEventListener('touchcancel', onTouchEnd, {
          passive: true,
        });
      }
    },
    onWheel: (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      active = true;
      scheduleFinish();
    },
    observeOffset: (offset: number, isScrolling: boolean) => {
      const logicalOffset = offset + adjustment;
      // iOS sends no touchstart for a fling that begins during momentum, so
      // native scrolling itself keeps the gesture active. Reaching an edge
      // also waits to settle: the boundary is where momentum bounces.
      if (isScrolling) {
        active = true;
        scheduleFinish();
      }
      reportedOffset = logicalOffset;
      return logicalOffset;
    },
    defer: (offset: number) => {
      const element = options.getElement();
      const previousOffset =
        reportedOffset ?? (element?.scrollTop ?? 0) + adjustment;
      reportedOffset = offset;
      if (!active || !element) return false;
      // Native scrolling can advance before its event reaches TanStack. Apply
      // only the layout delta; an absolute target would undo that unreported motion.
      adjustment += offset - previousOffset;
      options.setAdjustment(adjustment);
      return true;
    },
    logicalOffset: (offset: number) => offset + adjustment,
    finish,
    dispose: () => {
      clearTimer();
      releaseTouchTargets();
      active = false;
    },
  };
}
