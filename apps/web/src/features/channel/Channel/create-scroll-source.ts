/**
 * Decide which of the virtualizer's scroll events count as user scrolling.
 *
 * TanStack treats any event reported as scrolling as touch momentum on iOS
 * and defers size compensation until `scrollend`. An instant navigation or
 * correction is not momentum, so its own scroll event is not reported.
 */
export function createScrollSource(_isUserInteracting: () => boolean) {
  let programmaticOffset: number | undefined;
  let gestureActive = false;

  return {
    /** Record where an instant programmatic scroll landed in the DOM. */
    markProgrammatic(offset: number | undefined) {
      programmaticOffset = offset;
    },
    /** A gesture, including momentum past the input-event timeout, is driving scrolling. */
    isGestureActive: () => gestureActive,
    /** Classify one scroll event before forwarding it to the virtualizer. */
    classify(offset: number, isScrolling: boolean) {
      const isOwnScroll =
        programmaticOffset !== undefined &&
        Math.abs(offset - programmaticOffset) < 1.5;
      programmaticOffset = undefined;
      const isUserScroll = isScrolling && !isOwnScroll;
      if (isUserScroll) gestureActive = true;
      return isUserScroll;
    },
    /**
     * Call after the virtualizer handled the event. The gesture stays active
     * while the end callback flushes any deferred correction.
     */
    release(isUserScroll: boolean) {
      if (!isUserScroll) gestureActive = false;
    },
  };
}
