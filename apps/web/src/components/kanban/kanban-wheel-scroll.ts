const GESTURE_IDLE_MS = 180;

/** Keep wheel momentum with its original scroll viewport while columns move under the pointer. */
export function createKanbanWheelScroll(options: {
  viewport(): HTMLElement | undefined;
  verticalViewport(target: Element): HTMLElement | null;
  now?: () => number;
}) {
  let owner: { element: HTMLElement; horizontal: boolean } | undefined;
  let lastEvent = -Infinity;

  function reset() {
    owner = undefined;
    lastEvent = -Infinity;
  }

  function onWheel(event: WheelEvent) {
    if (event.ctrlKey) {
      reset();
      return;
    }

    if (event.defaultPrevented || (!event.deltaX && !event.deltaY)) {
      return;
    }

    const viewport = options.viewport();

    if (!viewport || !event.cancelable) {
      return;
    }

    const now = options.now?.() ?? performance.now();

    if (now - lastEvent > GESTURE_IDLE_MS || !owner?.element.isConnected) {
      const vertical =
        event.target instanceof Element
          ? options.verticalViewport(event.target)
          : null;
      const useVertical =
        vertical &&
        viewport.contains(vertical) &&
        vertical.scrollHeight > vertical.clientHeight &&
        !event.shiftKey &&
        Math.abs(event.deltaY) > Math.abs(event.deltaX);
      owner = useVertical
        ? { element: vertical, horizontal: false }
        : { element: viewport, horizontal: true };
    }

    lastEvent = now;
    const { element, horizontal } = owner;
    const length = horizontal ? element.clientWidth : element.clientHeight;
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? length : 1;
    const delta =
      horizontal && Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    const maximum = horizontal
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
    const previous = horizontal ? element.scrollLeft : element.scrollTop;
    const next = Math.max(
      0,
      Math.min(Math.max(0, maximum), previous + delta * unit)
    );

    if (horizontal) {
      element.scrollLeft = next;
    } else {
      element.scrollTop = next;
    }

    // Consume boundary events too: momentum must not leak into the element now under the pointer.
    event.preventDefault();
  }

  return { onWheel, reset };
}
