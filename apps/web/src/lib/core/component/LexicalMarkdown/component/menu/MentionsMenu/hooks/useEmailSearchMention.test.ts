import type { EntityItem } from '@core/context/quickAccess';
import type { EmailEntity } from '@entity';
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

const CACHED_THREAD: EntityItem = {
  id: 'cached-thread',
  kind: 'entity',
  bucket: 'email',
  searchText: 'Invitation to the project',
  sortTimestamp: 1,
  timestamps: { updatedAt: null, createdAt: null },
  data: {
    id: 'cached-thread',
    name: 'Invitation to the project',
    type: 'email',
    ownerId: 'owner',
  } as EntityItem['data'],
};

const OLDER_REST_THREAD = {
  type: 'email',
  id: 'older-rest-thread',
  name: 'Quarterly numbers',
  ownerId: 'owner',
  isDraft: false,
  updatedAt: new Date('2026-11-03T09:00:00Z'),
} as EmailEntity;

const REST_DRAFT = {
  type: 'email',
  id: 'rest-draft',
  name: 'Unsent reply',
  ownerId: 'owner',
  isDraft: true,
  updatedAt: new Date('2026-11-06T09:00:00Z'),
} as EmailEntity;

const NEWER_REST_THREAD = {
  type: 'email',
  id: 'newer-rest-thread',
  name: 'Receipt 1042',
  ownerId: 'owner',
  isDraft: false,
  updatedAt: new Date('2026-11-05T12:00:00Z'),
} as EmailEntity;

const mocks = vi.hoisted(() => ({
  bucketRows: [] as EntityItem[],
  searchEnabled: [] as boolean[],
  restEnabled: [] as boolean[],
  restSettled: true,
}));

beforeEach(() => {
  mocks.bucketRows = [];
  mocks.searchEnabled.length = 0;
  mocks.restEnabled.length = 0;
  mocks.restSettled = true;
});

/** The bucket's rows, narrowed by the term as the Quick Access search would. */
function bucketRowsMatching(term: string): EntityItem[] {
  return mocks.bucketRows.filter((row) =>
    row.searchText.toLowerCase().includes(term.toLowerCase())
  );
}

vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    usesRecordSelection: () => false,
    useList: (options: {
      enabled: () => boolean;
      searchTerm?: () => string;
    }) => ({
      items: () =>
        options.enabled()
          ? bucketRowsMatching(options.searchTerm?.() ?? '')
          : [],
      totalCount: () =>
        options.enabled()
          ? bucketRowsMatching(options.searchTerm?.() ?? '').length
          : 0,
      hasMore: () => false,
      isLoading: () => false,
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

vi.mock('@queries/soup/items', async () => {
  const { createRenderEffect } = await import('solid-js');
  return {
    useSoupItemsQuery: (
      _args: unknown,
      options: () => { enabled: boolean }
    ) => {
      createRenderEffect(() => mocks.restEnabled.push(options().enabled));
      return {
        get isSuccess() {
          return options().enabled && mocks.restSettled;
        },
        get isFetching() {
          return options().enabled && !mocks.restSettled;
        },
        data: [NEWER_REST_THREAD, REST_DRAFT, OLDER_REST_THREAD],
      };
    },
  };
});

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  QUERY_FILTERS_BASE: {},
}));

it('lists the newest REST threads, without drafts, when Quick Access has no emails', () => {
  const [term, setTerm] = createSignal('');
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: term,
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  expect(mention.emails().map((item) => item.id)).toEqual([
    'newer-rest-thread',
    'older-rest-thread',
  ]);
  expect(mocks.restEnabled.at(-1)).toBe(true);

  setTerm('Qu');
  expect(mention.emails().map((item) => item.id)).toEqual([
    'older-rest-thread',
  ]);

  setTerm('Quarterly');
  expect(mention.emails()).toEqual([]);
  expect(mocks.searchEnabled.at(-1)).toBe(true);
  dispose();
});

it('lists Quick Access threads, not drafts, and leaves the REST list alone when it has some', () => {
  mocks.bucketRows = [LOCAL_DRAFT, CACHED_THREAD];
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: () => '',
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  expect(mention.emails().map((item) => item.id)).toEqual(['cached-thread']);
  expect(mention.totalCount()).toBe(1);
  expect(mocks.restEnabled).not.toContain(true);
  dispose();
});

it('stays on Quick Access when it has threads but none match a short term', () => {
  mocks.bucketRows = [CACHED_THREAD];
  const [term, setTerm] = createSignal('');
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: term,
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  setTerm('zx');
  expect(mention.emails()).toEqual([]);
  expect(mocks.restEnabled).not.toContain(true);
  dispose();
});

it('reports the REST threads as loading until they arrive', () => {
  mocks.restSettled = false;
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: () => '',
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  expect(mention.emails()).toEqual([]);
  expect(mention.isLoadingMore()).toBe(true);
  expect(mention.hasMore()).toBe(false);
  dispose();
});

it('falls back to REST threads when Quick Access lists only drafts', () => {
  mocks.bucketRows = [LOCAL_DRAFT];
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({
      searchTerm: () => '',
      recentWhenShort: () => true,
    }),
    dispose,
  }));

  expect(mention.emails().map((item) => item.id)).toEqual([
    'newer-rest-thread',
    'older-rest-thread',
  ]);
  dispose();
});

it('keeps a mixed menu on search, so an empty term lists no threads', () => {
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEmailSearchMention({ searchTerm: () => '' }),
    dispose,
  }));

  expect(mention.emails()).toEqual([]);
  expect(mocks.searchEnabled.at(-1)).toBe(true);
  expect(mocks.restEnabled).not.toContain(true);
  dispose();
});
