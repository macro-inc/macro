import type { InfiniteData } from '@tanstack/solid-query';

/** Replaces a group's first page and keeps every continuation page it loaded. */
export function mergeGroupInitialPage<TPage>(
  existing: InfiniteData<TPage, string | null> | undefined,
  initialPage: TPage
): InfiniteData<TPage, string | null> {
  if (!existing || existing.pages.length <= 1) {
    return { pages: [initialPage], pageParams: [null] };
  }
  return {
    pages: [initialPage, ...existing.pages.slice(1)],
    pageParams: [null, ...existing.pageParams.slice(1)],
  };
}
