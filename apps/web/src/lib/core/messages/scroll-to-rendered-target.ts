import { getScrollParentElement } from '../util/scrollParent';

const DEFAULT_TIMEOUT_MS = 10_000;

export const USER_SCROLL_EVENTS = [
  'wheel',
  'touchmove',
  'keydown',
  'pointerdown',
] as const;

/**
 * Scrolls the message element under `root` whose `data-message-id` is
 * `messageId` into view, now or as soon as it renders. Gives up after
 * `timeoutMs`, or as soon as the user starts scrolling themselves, so a slow
 * load never yanks the view later.
 * Returns a cancel function.
 */
export function scrollToRenderedTarget(
  root: HTMLElement,
  messageId: string,
  options?: { timeoutMs?: number; onSettled?: () => void }
): () => void {
  let done = false;
  let observer: MutationObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let scroller: HTMLElement | null = null;
  let target: HTMLElement | undefined;
  let lastPlacement:
    | {
        element: HTMLElement;
        top: number;
        height: number;
        viewportHeight: number;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    scroller?.removeEventListener('scroll', onScroll);
    scroller?.removeEventListener('scrollend', onScrollEnd);
    if (timer !== undefined) clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS)
      window.removeEventListener(type, settle, true);
  };

  // Effect cleanup can pause a request while the editor loads again. Only
  // arrival, user takeover, or timeout consumes the navigation.
  function settle() {
    if (done) return;
    cancel();
    options?.onSettled?.();
  }

  const isPositioned = () => {
    if (!target?.isConnected || !scroller?.isConnected) return false;
    const message = target.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    if (message.height <= 0 || viewport.height <= 0) return false;
    return message.height <= viewport.height
      ? message.top >= viewport.top - 1 && message.bottom <= viewport.bottom + 1
      : message.top <= viewport.top + 1 &&
          message.bottom >= viewport.bottom - 1;
  };

  function onScrollEnd() {
    if (isPositioned()) settle();
    else tryScroll(true);
  }

  function onScroll() {
    if (isPositioned()) settle();
  }

  const tryScroll = (interrupted = false) => {
    if (done) return false;
    // Compared, not interpolated into a selector: the id comes from the URL.
    target = Array.from(
      root.querySelectorAll<HTMLElement>('[data-message-id]')
    ).find((element) => element.dataset.messageId === messageId);
    if (!target?.isConnected) return false;
    if (!scroller) {
      scroller = getScrollParentElement(root);
      if (scroller) {
        scroller.addEventListener('scroll', onScroll, { passive: true });
        scroller.addEventListener('scrollend', onScrollEnd);
        resizeObserver = new ResizeObserver(() => tryScroll());
        // The discussion's wrapper is display:contents. Observe its laid-out
        // ancestors too: loading or suspending the editor changes the target's
        // position without necessarily resizing the message itself.
        for (
          let element: HTMLElement | null = target;
          element;
          element = element.parentElement
        ) {
          resizeObserver.observe(element);
          if (element === scroller) break;
        }
      }
    }
    if (scroller) {
      const rect = target.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const top = rect.top - viewport.top + scroller.scrollTop;
      if (
        !interrupted &&
        lastPlacement?.element === target &&
        lastPlacement.top === top &&
        lastPlacement.height === rect.height &&
        lastPlacement.viewportHeight === viewport.height
      )
        return true;
      lastPlacement = {
        element: target,
        top,
        height: rect.height,
        viewportHeight: viewport.height,
      };
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // A smooth scroll can be interrupted by layout during the first open.
    // Keep the navigation pending until it lands, rather than consuming it as
    // soon as the message exists. Later refreshes must not restart it.
    if (!scroller || isPositioned()) settle();
    return true;
  };

  tryScroll();
  if (done) return cancel;

  observer = new MutationObserver(() => {
    tryScroll();
  });
  observer.observe(root, { childList: true, subtree: true });
  timer = setTimeout(settle, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  for (const type of USER_SCROLL_EVENTS)
    window.addEventListener(type, settle, { capture: true, passive: true });

  return cancel;
}
