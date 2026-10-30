import type { InfiniteData } from '@tanstack/solid-query';

export type MergedGroupPages<TPage> = {
  data: InfiniteData<TPage, string | null>;
  /** The kept pages no longer chain from the new first page's cursor. */
  stale: boolean;
};

/**
 * Replaces a group's first page and keeps every continuation page it loaded.
 * Group cursors are keyset cursors: when the new first page ends elsewhere,
 * the kept pages are reported stale so the caller re-walks the chain.
 */
export function mergeGroupInitialPage<TPage>(
  existing: InfiniteData<TPage, string | null> | undefined,
  initialPage: TPage,
  nextCursor: (page: TPage) => string | null
): MergedGroupPages<TPage> {
  if (!existing || existing.pages.length <= 1) {
    return { data: { pages: [initialPage], pageParams: [null] }, stale: false };
  }
  return {
    data: {
      pages: [initialPage, ...existing.pages.slice(1)],
      pageParams: [null, ...existing.pageParams.slice(1)],
    },
    stale: nextCursor(initialPage) !== existing.pageParams[1],
  };
}
