import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() => vi.fn());
const refreshes = vi.hoisted(() => ({
  laterPages: undefined as { read: () => boolean; freshMs: number } | undefined,
}));

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@queries/channel/by-ids', () => ({
  registerChannelListNotificationRefresh: (
    _query: unknown,
    _types: unknown,
    _ids: unknown,
    laterPages: { read: () => boolean; freshMs: number }
  ) => {
    refreshes.laterPages = laterPages;
  },
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));

import { useCollapsedUnreadChannels } from './collapsed-unread-channels';

afterEach(() => {
  useSoupAstItemsQuery.mockReset();
});

/**
 * A loaded first page with more behind it; `fetchNextPage` counts calls, and
 * three pages are kept until `resetToInitialPage` drops the later two.
 */
function firstPageWithMore(resetToInitialPage = vi.fn()) {
  const fetchNextPage = vi.fn(async () => {});
  useSoupAstItemsQuery.mockImplementation((_args, options) => {
    const [pages, setPages] = createSignal(3);
    return {
      resetToInitialPage: () => {
        resetToInitialPage();
        setPages(1);
      },
      get revalidationQueries() {
        return Array.from({ length: pages() }, () => ({}));
      },
      get isEnabled() {
        return options().enabled;
      },
      isPending: false,
      isFetching: false,
      isSuccess: true,
      hasPageData: true,
      hasNextPage: true,
      error: undefined,
      fetchError: undefined,
      fetchNextPage,
      data: { entities: [{ id: 'ch-1', type: 'channel' }] },
    };
  });
  return fetchNextPage;
}

describe('useCollapsedUnreadChannels', () => {
  it('reads only the first page unless a view lists every unread channel', () => {
    const fetchNextPage = firstPageWithMore();
    const [listsEvery, setListsEvery] = createSignal(false);
    const dispose = createRoot((dispose) => {
      useCollapsedUnreadChannels(() => true, listsEvery);
      return dispose;
    });
    try {
      expect(fetchNextPage).not.toHaveBeenCalled();
      setListsEvery(true);
      expect(fetchNextPage).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('drops the later pages once no view lists every unread channel', () => {
    const resetToInitialPage = vi.fn();
    firstPageWithMore(resetToInitialPage);
    const [listsEvery, setListsEvery] = createSignal(true);
    const dispose = createRoot((dispose) => {
      useCollapsedUnreadChannels(() => true, listsEvery);
      return dispose;
    });
    try {
      expect(resetToInitialPage).not.toHaveBeenCalled();
      setListsEvery(false);
      expect(resetToInitialPage).toHaveBeenCalledOnce();
      setListsEvery(true);
      expect(resetToInitialPage).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('reads the next page only while the view reads more, keeping its pages', () => {
    const resetToInitialPage = vi.fn();
    const fetchNextPage = firstPageWithMore(resetToInitialPage);
    const [readsMore, setReadsMore] = createSignal(false);
    const dispose = createRoot((dispose) => {
      useCollapsedUnreadChannels(
        () => true,
        () => true,
        readsMore
      );
      return dispose;
    });
    try {
      expect(fetchNextPage).not.toHaveBeenCalled();
      setReadsMore(true);
      expect(fetchNextPage).toHaveBeenCalledOnce();
      setReadsMore(false);
      expect(resetToInitialPage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('reads only the first page again on live updates while the view is off screen', () => {
    firstPageWithMore();
    const [readsMore, setReadsMore] = createSignal(true);
    const dispose = createRoot((dispose) => {
      useCollapsedUnreadChannels(
        () => true,
        () => true,
        readsMore
      );
      return dispose;
    });
    try {
      // Kept pages are read again once they have been stale for as long as
      // the query counts them fresh.
      expect(refreshes.laterPages?.freshMs).toBe(30_000);
      expect(refreshes.laterPages?.read()).toBe(true);
      setReadsMore(false);
      expect(refreshes.laterPages?.read()).toBe(false);
      setReadsMore(true);
      expect(refreshes.laterPages?.read()).toBe(true);
    } finally {
      dispose();
    }
  });

  it('follows every page by default while enabled', () => {
    const fetchNextPage = firstPageWithMore();
    const dispose = createRoot((dispose) => {
      useCollapsedUnreadChannels(() => true);
      return dispose;
    });
    try {
      expect(fetchNextPage).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
