import type { EntityItem } from '@core/context/quickAccess';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEmailSearchMention } from './useEmailSearchMention';

const LOCAL_DRAFT: EntityItem = {
  id: 'draft-key',
  kind: 'entity',
  bucket: 'email',
  searchText: 'Draft email',
  sortTimestamp: 2,
  timestamps: { updatedAt: null, createdAt: null },
  data: {
    id: 'draft-key',
    name: 'Draft email',
    type: 'email',
    ownerId: 'owner',
    isDraft: true,
  } as EntityItem['data'],
};

const RECENT_THREAD: EntityItem = {
  id: 'recent-thread',
  kind: 'entity',
  bucket: 'email',
  searchText: 'Invitation to the project',
  sortTimestamp: 1,
  timestamps: { updatedAt: null, createdAt: null },
  data: {
    id: 'recent-thread',
    name: 'Invitation to the project',
    type: 'email',
    ownerId: 'owner',
  } as EntityItem['data'],
};

const mocks = vi.hoisted(() => ({
  searchEnabled: [] as boolean[],
}));

beforeEach(() => {
  mocks.searchEnabled.length = 0;
});

vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    usesRecordSelection: () => false,
    useList: (options: { enabled: () => boolean }) => ({
      items: () => (options.enabled() ? [LOCAL_DRAFT, RECENT_THREAD] : []),
      totalCount: () => (options.enabled() ? 2 : 0),
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => undefined,
    }),
  }),
}));

vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: (text: string) => text.length >= 3,
  useSearchSoupQuery: (
    _args: unknown,
    options: () => { enabled: boolean }
  ) => ({
    get status() {
      mocks.searchEnabled.push(options().enabled);
      return 'pending';
    },
    data: [],
    hasNextPage: false,
    isFetching: false,
  }),
}));

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  QUERY_FILTERS_BASE: {},
}));

it('lists recent threads, not drafts, for an email-only menu until the term can be searched', () => {
  const [term, setTerm] = createSignal('');
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: term,
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  expect(mention.emails().map((item) => item.id)).toEqual(['recent-thread']);
  expect(mention.totalCount()).toBe(1);

  setTerm('in');
  expect(mention.emails().map((item) => item.id)).toEqual(['recent-thread']);

  setTerm('invitation');
  expect(mention.emails()).toEqual([]);
  expect(mocks.searchEnabled.at(-1)).toBe(true);
  dispose();
});

it('keeps a mixed menu on search, so an empty term lists no threads', () => {
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({ searchTerm: () => '' }),
    dispose,
  }));

  expect(mention.emails()).toEqual([]);
  expect(mocks.searchEnabled.at(-1)).toBe(true);
  dispose();
});
