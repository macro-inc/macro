import { type Accessor, createEffect, onCleanup } from 'solid-js';

interface UseInfiniteScrollSentinelOptions {
  /** Ref to the sentinel element placed at the bottom of the list. */
  sentinel: Accessor<HTMLElement | undefined>;
  /** Whether there's another page to fetch — observation pauses when false. */
  hasNextPage: Accessor<boolean>;
  /** True while a next-page fetch is in flight (used to avoid duplicate calls). */
  isFetchingNextPage: Accessor<boolean>;
  /** Fires when the sentinel scrolls into view and we can fetch more. */
  fetchNextPage: () => void;
  /** Extra pre-trigger margin (default `200px`). */
  rootMargin?: string;
}

/**
 * Walks up the DOM to find the nearest scrollable ancestor. IO with the
 * viewport as root doesn't work reliably for sentinels inside nested
 * scroll containers, so we want to observe relative to the actual scroller.
 * Returns `null` (viewport fallback) when no scrollable ancestor exists.
 */
function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Fires `fetchNextPage` whenever the sentinel scrolls into (or close to)
 * view, gated by `hasNextPage` + `isFetchingNextPage`. The observer is
 * torn down and re-created whenever the sentinel ref or `hasNextPage`
 * changes — when there are no more pages, no observer runs.
 */
export function useInfiniteScrollSentinel(
  opts: UseInfiniteScrollSentinelOptions
) {
  createEffect(() => {
    const node = opts.sentinel();
    if (!node || !opts.hasNextPage()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!opts.hasNextPage() || opts.isFetchingNextPage()) return;
        opts.fetchNextPage();
      },
      {
        root: findScrollableParent(node),
        rootMargin: opts.rootMargin ?? '200px',
      }
    );

    observer.observe(node);
    onCleanup(() => observer.disconnect());
  });
}
