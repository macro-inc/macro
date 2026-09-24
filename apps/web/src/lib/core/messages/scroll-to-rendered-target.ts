const DEFAULT_TIMEOUT_MS = 10_000;

const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown'] as const;

/**
 * Scrolls the first element under `root` matching `selector` into view, now or
 * as soon as it renders. Gives up after `timeoutMs`, or as soon as the user
 * starts scrolling themselves, so a slow load never yanks the view later.
 * Returns a cancel function.
 */
export function scrollToRenderedTarget(
  root: HTMLElement,
  selector: string,
  options?: { timeoutMs?: number }
): () => void {
  let done = false;
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS)
      window.removeEventListener(type, cancel, true);
  };

  const tryScroll = () => {
    const target = root.querySelector<HTMLElement>(selector);
    if (!target) return false;
    cancel();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  };

  if (tryScroll()) return cancel;

  observer = new MutationObserver(() => {
    tryScroll();
  });
  observer.observe(root, { childList: true, subtree: true });
  timer = setTimeout(cancel, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  for (const type of USER_SCROLL_EVENTS)
    window.addEventListener(type, cancel, { capture: true, passive: true });

  return cancel;
}
