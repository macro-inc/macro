import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() => vi.fn());

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@queries/channel/by-ids', () => ({
  registerChannelListNotificationRefresh: () => {},
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));

import { useCollapsedUnreadChannels } from './collapsed-unread-channels';

afterEach(() => {
  useSoupAstItemsQuery.mockReset();
});

/** A loaded first page with more behind it; `fetchNextPage` counts calls. */
function firstPageWithMore(resetToInitialPage = vi.fn()) {
  const fetchNextPage = vi.fn(async () => {});
  useSoupAstItemsQuery.mockImplementation((_args, options) => ({
    resetToInitialPage,
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
  }));
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
