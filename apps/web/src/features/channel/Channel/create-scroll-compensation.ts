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
    timer = setTimeout(() => {
      const element = options.getElement();
      // Do not interrupt iOS rubber-banding. Retry even without another scroll event.
      if (
        element &&
        (element.scrollTop < 0 ||
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
      const element = options.getElement();
      const logicalOffset = offset + adjustment;
      if (
        adjustment !== 0 &&
        element &&
        offset >= 0 &&
        offset <= element.scrollHeight - element.clientHeight &&
        (offset <= 0 ||
          offset >= element.scrollHeight - element.clientHeight ||
          logicalOffset <= 0 ||
          logicalOffset >= element.scrollHeight - element.clientHeight)
      ) {
        // Release the shifted origin at either edge so all history remains reachable.
        finish();
        reportedOffset = element.scrollTop;
        return reportedOffset;
      }
      if (active && isScrolling) scheduleFinish();
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
