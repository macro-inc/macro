import { watchTouchDrag } from '@channel/touch-drag';

const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const CHANNEL_THREAD_ROW_SELECTOR = '[data-channel-thread-row]';
const TARGET_SCROLL_QUIET_MS = 200;
const TARGET_SCROLL_TIMEOUT_MS = 1000;
const TARGET_MEASUREMENT_TIMEOUT_MS = 250;
const TARGET_VISIBILITY_TOLERANCE_PX = 1;
/**
 * How long to keep waiting for a scroll surface that has no box yet — an app
 * launched into a squished viewport, or a panel mounted before layout. The
 * target is only released after this, because releasing it early strands the
 * channel wherever it mounted.
 */
const TARGET_UNMEASURED_TIMEOUT_MS = 5000;

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

export type TargetReplyScroller = {
  scrollToIndex: (index: number, onSettled: () => void) => boolean;
  cancel: () => void;
  dispose: () => void;
};

/**
 * Keeps a nested reply positioned while the outer channel virtualizer measures
 * its newly expanded thread row.
 */
export function createTargetReplyScroller(options: {
  getTarget: (index: number) => HTMLElement | undefined;
  positionTarget?: (
    threadRow: HTMLElement,
    targetElement: HTMLElement
  ) => boolean;
}): TargetReplyScroller {
  let cancelCurrentScroll: (() => void) | undefined;

  const cancel = () => cancelCurrentScroll?.();

  const scrollToIndex = (index: number, onSettled: () => void): boolean => {
    cancel();

    const initialTarget = options.getTarget(index);
    if (!initialTarget) return false;

    const scrollElement = initialTarget.closest<HTMLElement>(
      CHANNEL_SCROLL_SELECTOR
    );
    if (!scrollElement) return false;

    let completed = false;
    let positionRafId = 0;
    let measurementRafId = 0;
    let completionRafId = 0;
    let verifyTimerId: number | undefined;
    let measurementTimerId: number | undefined;
    let measurementMicrotaskQueued = false;
    let hasPositioned = false;
    const startedAt = performance.now();
    // When the scroll surface first had a box to position against. The
    // give-up deadline runs from here, not from `startedAt`, so time spent
    // waiting on an unmeasured viewport never burns the retry budget.
    let measuredSince: number | undefined;
    let unwatchTouchDrag: (() => void) | undefined;
    const getThreadRow = () =>
      options
        .getTarget(index)
        ?.closest<HTMLElement>(CHANNEL_THREAD_ROW_SELECTOR);
    const threadRow = getThreadRow();
    const virtualItem = threadRow?.parentElement;

    const resizeObserver = threadRow
      ? new ResizeObserver(() => schedulePositionAfterMeasurement())
      : undefined;
    // Measuring an earlier virtual item can change this wrapper's absolute
    // offset without resizing the target row. Observe that position update so
    // the correction runs in the mutation microtask checkpoint before paint.
    const positionObserver = virtualItem
      ? new MutationObserver(() => {
          if (!completed) positionTarget();
        })
      : undefined;

    const cleanup = () => {
      if (positionRafId) cancelAnimationFrame(positionRafId);
      if (measurementRafId) cancelAnimationFrame(measurementRafId);
      if (completionRafId) cancelAnimationFrame(completionRafId);
      if (verifyTimerId !== undefined) window.clearTimeout(verifyTimerId);
      if (measurementTimerId !== undefined)
        window.clearTimeout(measurementTimerId);
      resizeObserver?.disconnect();
      positionObserver?.disconnect();
      scrollElement.removeEventListener('wheel', handleUserScroll);
      scrollElement.removeEventListener('keydown', handleKeyDown);
      unwatchTouchDrag?.();
      if (cancelCurrentScroll === abort) cancelCurrentScroll = undefined;
    };

    const abort = () => {
      if (completed) return;
      completed = true;
      cleanup();
    };

    const complete = () => {
      if (completed) return;
      completed = true;
      cleanup();
      onSettled();
    };

    /**
     * Whether the scroll surface has a box to position against. An app that
     * launched into a squished viewport reports 0×0 for everything, and every
     * comparison against a zero rect passes trivially.
     */
    const isScrollSurfaceMeasured = () =>
      scrollElement.isConnected &&
      scrollElement.getBoundingClientRect().height > 0;

    const isTargetPositioned = () => {
      const target = options.getTarget(index);
      if (!target?.isConnected || !scrollElement.isConnected) return false;

      const targetRect = target.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      // Nothing is laid out yet, so the target cannot be judged as on screen.
      // Reporting it as positioned here releases the target and leaves the
      // channel parked wherever it mounted — the top of the loaded window.
      if (scrollRect.height <= 0 || targetRect.height <= 0) return false;
      if (targetRect.height <= scrollRect.height) {
        return (
          targetRect.top >= scrollRect.top - TARGET_VISIBILITY_TOLERANCE_PX &&
          targetRect.bottom <=
            scrollRect.bottom + TARGET_VISIBILITY_TOLERANCE_PX
        );
      }

      return (
        targetRect.top <= scrollRect.top + TARGET_VISIBILITY_TOLERANCE_PX &&
        targetRect.bottom >= scrollRect.bottom - TARGET_VISIBILITY_TOLERANCE_PX
      );
    };

    const scheduleVerification = () => {
      if (verifyTimerId !== undefined) window.clearTimeout(verifyTimerId);
      verifyTimerId = window.setTimeout(() => {
        verifyTimerId = undefined;
        if (isTargetPositioned()) {
          complete();
          return;
        }

        if (!isScrollSurfaceMeasured()) {
          // Keep waiting (bounded) rather than releasing a target that was
          // never given a viewport to land in.
          if (performance.now() - startedAt < TARGET_UNMEASURED_TIMEOUT_MS) {
            scheduleVerification();
            return;
          }
          complete();
          return;
        }

        measuredSince ??= performance.now();
        if (performance.now() - measuredSince < TARGET_SCROLL_TIMEOUT_MS) {
          schedulePosition();
          return;
        }

        // Do one final correction before releasing the one-shot target.
        options.getTarget(index)?.scrollIntoView({ block: 'center' });
        completionRafId = requestAnimationFrame(() => {
          completionRafId = 0;
          complete();
        });
      }, TARGET_SCROLL_QUIET_MS);
    };

    const positionTarget = () => {
      const target = options.getTarget(index);
      if (!target?.isConnected) {
        scheduleVerification();
        return;
      }
      const currentThreadRow = getThreadRow();
      const positionedByVirtualizer =
        currentThreadRow && options.positionTarget?.(currentThreadRow, target);
      if (!positionedByVirtualizer) {
        target.scrollIntoView({ block: 'center' });
      }
      hasPositioned = true;
      scheduleVerification();
    };

    function schedulePosition() {
      if (completed || positionRafId) return;
      positionRafId = requestAnimationFrame(() => {
        positionRafId = 0;
        positionTarget();
      });
    }

    function schedulePositionAfterMeasurement() {
      if (completed) return;
      // ResizeObserver callbacks run before paint, but callback order between
      // observers is not a safe contract. Defer to a microtask so Virtua's
      // sibling observer has applied the new item geometry before we position
      // against it, while still correcting before the browser can paint.
      if (!measurementMicrotaskQueued) {
        measurementMicrotaskQueued = true;
        queueMicrotask(() => {
          measurementMicrotaskQueued = false;
          if (!completed) positionTarget();
        });
      }
      if (!hasPositioned && positionRafId) {
        cancelAnimationFrame(positionRafId);
        positionRafId = 0;
      }
      if (measurementRafId) cancelAnimationFrame(measurementRafId);
      if (measurementTimerId !== undefined) {
        window.clearTimeout(measurementTimerId);
        measurementTimerId = undefined;
      }

      // Virtua may commit a corrected item range in the first frame after a
      // row measurement. Position in the following frame against that DOM.
      measurementRafId = requestAnimationFrame(() => {
        measurementRafId = requestAnimationFrame(() => {
          measurementRafId = 0;
          positionTarget();
        });
      });
    }

    function handleUserScroll() {
      complete();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (SCROLL_KEYS.has(event.key)) complete();
    }

    scrollElement.addEventListener('wheel', handleUserScroll, {
      passive: true,
    });
    scrollElement.addEventListener('keydown', handleKeyDown);
    // Only a drag hands the scroll back to the user. A tap — including the one
    // that lands while the channel is still opening — must not release the
    // target, or the navigation is abandoned before it ever moved.
    unwatchTouchDrag = watchTouchDrag(scrollElement, complete);
    if (threadRow) resizeObserver?.observe(threadRow);
    if (virtualItem) {
      positionObserver?.observe(virtualItem, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    cancelCurrentScroll = abort;

    // Wait for the outer row's initial measurement before the first visible
    // movement. ResizeObserver delivers an initial notification on observe;
    // the timeout is only a defensive fallback for disconnected/mocked DOM.
    measurementTimerId = window.setTimeout(() => {
      measurementTimerId = undefined;
      if (!hasPositioned) schedulePosition();
    }, TARGET_MEASUREMENT_TIMEOUT_MS);
    return true;
  };

  return {
    scrollToIndex,
    cancel,
    dispose: cancel,
  };
}
