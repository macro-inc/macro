const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const CHANNEL_THREAD_ROW_SELECTOR = '[data-channel-thread-row]';
const TARGET_SCROLL_QUIET_MS = 200;
const TARGET_SCROLL_TIMEOUT_MS = 1000;
const TARGET_MEASUREMENT_TIMEOUT_MS = 250;
const TARGET_VISIBILITY_TOLERANCE_PX = 1;

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
      scrollElement.removeEventListener('pointerdown', handlePointerDown);
      scrollElement.removeEventListener('keydown', handleKeyDown);
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

    const isTargetPositioned = () => {
      const target = options.getTarget(index);
      if (!target?.isConnected || !scrollElement.isConnected) return false;

      const targetRect = target.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
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

        if (performance.now() - startedAt < TARGET_SCROLL_TIMEOUT_MS) {
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

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch') complete();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (SCROLL_KEYS.has(event.key)) complete();
    }

    scrollElement.addEventListener('wheel', handleUserScroll, {
      passive: true,
    });
    scrollElement.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    scrollElement.addEventListener('keydown', handleKeyDown);
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
