/**
 * @vitest-environment jsdom
 */

import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { SoupPage } from '@service-storage/generated/schemas/soupPage';
import type { InfiniteData } from '@tanstack/solid-query';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const mockNormalizer = {
  setNormalizedData: vi.fn(),
  getDependentQueriesByIds: vi.fn<(ids: string[]) => unknown[][]>(() => []),
  getObjectById: vi.fn<(id: string) => unknown>(() => null),
};

vi.mock('./normalizer', () => ({
  getSoupNormalizer: () => mockNormalizer,
  getNormalizationObjectKey: (obj: Record<string, unknown>) => {
    if ('tag' in obj && 'data' in obj) {
      const data = obj.data as Record<string, unknown>;
      if (obj.tag === 'channel') {
        const channel = data?.channel as Record<string, unknown> | undefined;
        return channel?.id ? `soup:${channel.id}` : undefined;
      }
      return data?.id ? `soup:${data.id}` : undefined;
    }
    return undefined;
  },
  SOUP_NORM_PREFIX: 'soup:',
  soupNormKey: (id: string) => `soup:${id}`,
  stripSoupNormPrefix: (normKey: string) => normKey.slice('soup:'.length),
}));

import { soupKeys } from '../keys';
import {
  // biome-ignore lint/correctness/noPrivateImports: testing private export
  buildSingleEntityFilter,
  getSoupItemId,
  insertSoupEntity,
  optimisticUpdateSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  removeSearchEntities,
  removeSoupEntities,
} from './operations';

// -- Fixtures --

function mockDocumentItem(id: string): SoupApiItem {
  return {
    tag: 'document',
    data: { id, title: 'doc' },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function mockDocumentItemWithUpdatedAt(
  id: string,
  updatedAt: string
): SoupApiItem {
  return {
    tag: 'document',
    data: { id, title: 'doc', updatedAt },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function mockChannelItem(id: string): SoupApiItem {
  return {
    tag: 'channel',
    data: { channel: { id, name: 'ch' } },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function mockChannelItemWithUpdatedAt(
  id: string,
  updatedAt: string
): SoupApiItem {
  return {
    tag: 'channel',
    data: { channel: { id, name: 'ch', updated_at: updatedAt } },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function mockChatItem(id: string): SoupApiItem {
  return {
    tag: 'chat',
    data: { id, title: 'chat' },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function mockSoupCache(
  pages: SoupApiItem[][]
): InfiniteData<SoupPage, unknown> {
  return {
    pages: pages.map((items) => ({ items })),
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  };
}

function mockSearchResult(type: string, id: string): UnifiedSearchResponseItem {
  switch (type) {
    case 'document':
      return {
        type: 'document',
        document_id: id,
      } as unknown as UnifiedSearchResponseItem;
    case 'chat':
      return {
        type: 'chat',
        chat_id: id,
      } as unknown as UnifiedSearchResponseItem;
    case 'channel':
      return {
        type: 'channel',
        channel_id: id,
      } as unknown as UnifiedSearchResponseItem;
    case 'project':
      return { type: 'project', id } as unknown as UnifiedSearchResponseItem;
    default:
      throw new Error(`Unknown search type: ${type}`);
  }
}

function mockSearchCache(
  pages: UnifiedSearchResponseItem[][]
): InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown> {
  return {
    pages: pages.map((results) => ({ results })),
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  };
}

/** Legacy `items` query (flat SoupPage shape) — used by the bulk of the
 * pre-existing tests since they assert behavior agnostic of kind. */
const soupSeedKey = [...soupKeys.items._def, 'seed'];
const searchSeedKey = [...soupKeys.search._def, 'seed'];

function seedSoupQuery(data: InfiniteData<SoupPage, unknown>) {
  testQueryClient.setQueryData(soupSeedKey, data);
}

function getSoupQuery(): InfiniteData<SoupPage, unknown> | undefined {
  return testQueryClient.getQueryData(soupSeedKey);
}

function seedSearchQuery(
  data: InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
) {
  testQueryClient.setQueryData(searchSeedKey, data);
}

function getSearchQuery() {
  return testQueryClient.getQueryData<
    InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
  >(searchSeedKey);
}

// -- Shared setup --

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
});

afterEach(() => {
  testQueryClient.clear();
});

// -- Tests --

describe('getSoupItemId', () => {
  it('returns data.id for standard tags', () => {
    expect(getSoupItemId(mockDocumentItem('abc-123'))).toBe('abc-123');
  });

  it('returns data.channel.id for channel tag', () => {
    expect(getSoupItemId(mockChannelItem('ch-456'))).toBe('ch-456');
  });
});

describe('buildSingleEntityFilter', () => {
  const NIL_ID = '00000000-0000-0000-0000-000000000000';

  it.each([
    {
      entityType: 'document' as const,
      filterKey: 'document_filters',
      idKey: 'document_ids',
    },
    {
      entityType: 'chat' as const,
      filterKey: 'chat_filters',
      idKey: 'chat_ids',
    },
    {
      entityType: 'channel' as const,
      filterKey: 'channel_filters',
      idKey: 'channel_ids',
    },
    {
      entityType: 'project' as const,
      filterKey: 'project_filters',
      idKey: 'project_ids',
    },
    {
      entityType: 'call' as const,
      filterKey: 'call_filters',
      idKey: 'call_ids',
    },
  ])('unblocks only $entityType filter with the real entityId', ({
    entityType,
    filterKey,
    idKey,
  }) => {
    const filter = buildSingleEntityFilter(entityType, 'entity-1')!;
    expect(filter).not.toBeNull();
    expect(filter.limit).toBe(1);

    // The target filter uses the real entityId
    expect((filter as any)[filterKey][idKey]).toEqual(['entity-1']);

    // All other ID-based filters use NIL_ID
    const otherFilters = [
      'document_filters',
      'chat_filters',
      'channel_filters',
      'project_filters',
      'call_filters',
    ].filter((k) => k !== filterKey);

    for (const key of otherFilters) {
      const ids = Object.values((filter as any)[key])[0];
      expect(ids).toEqual([NIL_ID]);
    }
  });

  it('project filter defaults include_root to false', () => {
    const filter = buildSingleEntityFilter('project', 'entity-1');
    expect((filter as any).project_filters.include_root).toBe(false);
  });

  it('project filter respects includeRoot option', () => {
    const filter = buildSingleEntityFilter('project', 'entity-1', {
      includeRoot: true,
    });
    expect((filter as any).project_filters.include_root).toBe(true);
  });
});

describe('insertSoupEntity', () => {
  it('prepends item to first page only', () => {
    const page0 = [mockDocumentItem('d-1')];
    const page1 = [mockDocumentItem('d-2')];
    seedSoupQuery(mockSoupCache([page0, page1]));

    const newItem = mockChatItem('c-1');
    insertSoupEntity(newItem);

    const cached = getSoupQuery()!;
    expect(cached.pages[0].items).toHaveLength(2);
    expect(getSoupItemId(cached.pages[0].items[0])).toBe('c-1');
    expect(getSoupItemId(cached.pages[0].items[1])).toBe('d-1');
    expect(cached.pages[1].items).toHaveLength(1);
    expect(getSoupItemId(cached.pages[1].items[0])).toBe('d-2');
  });

  it('rollback restores original state', () => {
    const original = mockSoupCache([[mockDocumentItem('d-1')]]);
    seedSoupQuery(original);

    const tx = insertSoupEntity(mockChatItem('c-1'));
    expect(getSoupQuery()!.pages[0].items).toHaveLength(2);

    tx.rollback();
    const restored = getSoupQuery()!;
    expect(restored.pages[0].items).toHaveLength(1);
    expect(getSoupItemId(restored.pages[0].items[0])).toBe('d-1');
  });
});

describe('removeSoupEntities', () => {
  it('filters matching IDs from all pages', () => {
    seedSoupQuery(
      mockSoupCache([
        [mockDocumentItem('d-1'), mockChatItem('c-1')],
        [mockDocumentItem('d-2'), mockChannelItem('ch-1')],
      ])
    );

    removeSoupEntities(new Set(['d-1', 'ch-1']));

    const cached = getSoupQuery()!;
    expect(cached.pages[0].items).toHaveLength(1);
    expect(getSoupItemId(cached.pages[0].items[0])).toBe('c-1');
    expect(cached.pages[1].items).toHaveLength(1);
    expect(getSoupItemId(cached.pages[1].items[0])).toBe('d-2');
  });

  it('rollback restores removed items', () => {
    seedSoupQuery(
      mockSoupCache([[mockDocumentItem('d-1'), mockChatItem('c-1')]])
    );

    const tx = removeSoupEntities(new Set(['d-1']));
    expect(getSoupQuery()!.pages[0].items).toHaveLength(1);

    tx.rollback();
    const restored = getSoupQuery()!;
    expect(restored.pages[0].items).toHaveLength(2);
    expect(getSoupItemId(restored.pages[0].items[0])).toBe('d-1');
  });
});

describe('removeSearchEntities', () => {
  it('filters matching IDs from search results', () => {
    seedSearchQuery(
      mockSearchCache([
        [
          mockSearchResult('document', 'doc-1'),
          mockSearchResult('chat', 'chat-1'),
        ],
        [mockSearchResult('channel', 'ch-1')],
      ])
    );

    removeSearchEntities(new Set(['doc-1', 'ch-1']));

    const cached = getSearchQuery()!;
    expect(cached.pages[0].results).toHaveLength(1);
    expect(cached.pages[0].results[0].type).toBe('chat');
    expect(cached.pages[1].results).toHaveLength(0);
  });

  it('rollback restores removed search results', () => {
    seedSearchQuery(
      mockSearchCache([
        [
          mockSearchResult('document', 'doc-1'),
          mockSearchResult('chat', 'chat-1'),
        ],
      ])
    );

    const tx = removeSearchEntities(new Set(['doc-1']));
    expect(getSearchQuery()!.pages[0].results).toHaveLength(1);

    tx.rollback();
    const restored = getSearchQuery()!;
    expect(restored.pages[0].results).toHaveLength(2);
  });
});

describe('optimisticUpdateSoupEntity', () => {
  it('rollback restores dependent query data', () => {
    const dependentKey = [...soupKeys.astItems._def, 'dependent'];
    const originalData = mockSoupCache([[mockDocumentItem('d-1')]]);
    testQueryClient.setQueryData(dependentKey, originalData);

    mockNormalizer.getDependentQueriesByIds.mockReturnValueOnce([dependentKey]);

    const tx = optimisticUpdateSoupEntity(mockDocumentItem('d-1'));

    tx.rollback();

    const restored =
      testQueryClient.getQueryData<InfiniteData<SoupPage, unknown>>(
        dependentKey
      );
    expect(restored).toEqual(originalData);
  });
});

describe('optimisticUpdateSoupItemUpdatedAt', () => {
  it('updates updatedAt for non-channel entities', () => {
    mockNormalizer.getObjectById.mockReturnValueOnce(mockDocumentItem('doc-1'));

    optimisticUpdateSoupItemUpdatedAt(
      'doc-1',
      'document',
      '2024-01-01T00:00:00.000Z'
    );

    expect(mockNormalizer.setNormalizedData).toHaveBeenCalledWith({
      tag: 'document',
      data: { id: 'doc-1', updatedAt: '2024-01-01T00:00:00.000Z' },
      frecency_score: 1,
    });
  });

  it('updates updated_at for channel entities', () => {
    mockNormalizer.getObjectById.mockReturnValueOnce(mockChannelItem('ch-1'));

    optimisticUpdateSoupItemUpdatedAt(
      'ch-1',
      'channel',
      '2024-01-01T00:00:00.000Z'
    );

    expect(mockNormalizer.setNormalizedData).toHaveBeenCalledWith({
      tag: 'channel',
      data: {
        channel: { id: 'ch-1', updated_at: '2024-01-01T00:00:00.000Z' },
      },
      frecency_score: 1,
    });
  });

  it('does not update when incoming updatedAt is older or equal (non-channel)', () => {
    mockNormalizer.getObjectById.mockReturnValueOnce(
      mockDocumentItemWithUpdatedAt('doc-1', '2024-01-02T00:00:00.000Z')
    );
    optimisticUpdateSoupItemUpdatedAt(
      'doc-1',
      'document',
      '2024-01-01T00:00:00.000Z'
    );

    mockNormalizer.getObjectById.mockReturnValueOnce(
      mockDocumentItemWithUpdatedAt('doc-1', '2024-01-02T00:00:00.000Z')
    );
    optimisticUpdateSoupItemUpdatedAt(
      'doc-1',
      'document',
      '2024-01-02T00:00:00.000Z'
    );

    expect(mockNormalizer.setNormalizedData).not.toHaveBeenCalled();
  });

  it('does not update when incoming updated_at is older (channel)', () => {
    mockNormalizer.getObjectById.mockReturnValueOnce(
      mockChannelItemWithUpdatedAt('ch-1', '2024-01-02T00:00:00.000Z')
    );

    optimisticUpdateSoupItemUpdatedAt(
      'ch-1',
      'channel',
      '2024-01-01T00:00:00.000Z'
    );

    expect(mockNormalizer.setNormalizedData).not.toHaveBeenCalled();
  });

  it('does nothing when cache entity is missing or tag mismatches', () => {
    optimisticUpdateSoupItemUpdatedAt(
      'doc-1',
      'document',
      '2024-01-01T00:00:00.000Z'
    );

    mockNormalizer.getObjectById.mockReturnValueOnce(mockDocumentItem('doc-1'));
    optimisticUpdateSoupItemUpdatedAt(
      'doc-1',
      'chat',
      '2024-01-01T00:00:00.000Z'
    );

    expect(mockNormalizer.setNormalizedData).not.toHaveBeenCalled();
  });
});

// -- Normalized grouped cache tests --

import type { GroupByField, GroupMeta } from '../grouped/types';
import { NOT_SET_GROUP_KEY } from '../grouped/types';
import type { SoupAstItemsGroupedPage } from '../items';

const STATUS_DEF = 'status-def-id';
const STATUS_GROUP_BY: GroupByField = {
  type: 'property',
  propertyDefinitionId: STATUS_DEF,
};

/** Build a task-like document item with a status property value. */
function mockTaskItem(id: string, statusOption: string): SoupApiItem {
  return {
    tag: 'document',
    data: {
      id,
      title: `task ${id}`,
      properties: [
        {
          definition: { id: STATUS_DEF },
          value: { type: 'SelectOption', value: [statusOption] },
        },
      ],
    },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

/** Build an email-thread item. Emails carry no task properties, so under a
 * property grouping they resolve to the NOT_SET bucket. */
function mockEmailItem(id: string): SoupApiItem {
  return {
    tag: 'emailThread',
    data: { id, subject: `email ${id}` },
    frecency_score: 1,
  } as unknown as SoupApiItem;
}

function buildGroup(
  key: string,
  itemIds: string[],
  totalCount?: number,
  displayOrder?: number
): GroupMeta {
  return {
    key,
    label: key,
    displayOrder: displayOrder ?? null,
    totalCount: totalCount ?? itemIds.length,
    itemIds,
    nextCursor: null,
  };
}

function mockGroupedParentCache(
  items: SoupApiItem[],
  groups: GroupMeta[]
): InfiniteData<SoupAstItemsGroupedPage, unknown> {
  const itemsById: Record<string, SoupApiItem> = {};
  for (const it of items) itemsById[getSoupItemId(it)] = it;
  return {
    pages: [
      {
        kind: 'grouped',
        items: itemsById,
        groups,
        nextCursor: null,
      },
    ],
    pageParams: [null],
  };
}

/** Seed a grouped astItems query with status property grouping metadata. */
function seedGroupedAstQuery(
  data: InfiniteData<SoupAstItemsGroupedPage, unknown>,
  suffix = 'grouped-seed'
) {
  const key = [...soupKeys.astItems._def, {}, {}, STATUS_GROUP_BY, suffix];
  testQueryClient.setQueryDefaults(key, { meta: { groupBy: STATUS_GROUP_BY } });
  testQueryClient.setQueryData(key, data);
  return key;
}

/** Seed a grouped astItems query that also carries an item filter, mirroring
 * a list view's `soupItemMatchesListView` gate. */
function seedGroupedAstQueryWithFilter(
  data: InfiniteData<SoupAstItemsGroupedPage, unknown>,
  itemFilter: (item: SoupApiItem) => boolean,
  suffix = 'grouped-filtered-seed'
) {
  const key = [...soupKeys.astItems._def, {}, {}, STATUS_GROUP_BY, suffix];
  testQueryClient.setQueryDefaults(key, {
    meta: { groupBy: STATUS_GROUP_BY, itemFilter },
  });
  testQueryClient.setQueryData(key, data);
  return key;
}

describe('insertSoupEntity — grouped cache', () => {
  it('adds item to items pool and prepends id to target group itemIds', () => {
    const items = [
      mockTaskItem('a-1', 'in_progress'),
      mockTaskItem('b-1', 'done'),
    ];
    const groups = [
      buildGroup('in_progress', ['a-1'], 3, 0),
      buildGroup('done', ['b-1'], 2, 1),
    ];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    insertSoupEntity(mockTaskItem('a-new', 'in_progress'));

    const cached =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    const page = cached.pages[0];

    // Pool gained the new item.
    expect(page.items['a-new']).toBeDefined();
    // in_progress gained the id at the top; totalCount bumped.
    const inProgress = page.groups.find((g) => g.key === 'in_progress')!;
    expect(inProgress.itemIds).toEqual(['a-new', 'a-1']);
    expect(inProgress.totalCount).toBe(4);
    // done untouched.
    const done = page.groups.find((g) => g.key === 'done')!;
    expect(done.itemIds).toEqual(['b-1']);
    expect(done.totalCount).toBe(2);
  });

  it('rollback restores grouped cache', () => {
    const items = [mockTaskItem('a-1', 'in_progress')];
    const groups = [buildGroup('in_progress', ['a-1'], 1, 0)];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    const tx = insertSoupEntity(mockTaskItem('a-new', 'in_progress'));
    tx.rollback();

    const restored =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    expect(restored.pages[0].items['a-new']).toBeUndefined();
    expect(restored.pages[0].groups[0].itemIds).toEqual(['a-1']);
    expect(restored.pages[0].groups[0].totalCount).toBe(1);
  });
});

describe('removeSoupEntities — grouped cache', () => {
  it('drops from pool, filters itemIds, decrements totalCount per affected group', () => {
    const items = [
      mockTaskItem('a-1', 'in_progress'),
      mockTaskItem('a-2', 'in_progress'),
      mockTaskItem('b-1', 'done'),
    ];
    const groups = [
      buildGroup('in_progress', ['a-1', 'a-2'], 5, 0),
      buildGroup('done', ['b-1'], 3, 1),
    ];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    removeSoupEntities(new Set(['a-1']));

    const cached =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    const page = cached.pages[0];
    expect(page.items['a-1']).toBeUndefined();
    expect(page.items['a-2']).toBeDefined();

    const inProgress = page.groups.find((g) => g.key === 'in_progress')!;
    expect(inProgress.itemIds).toEqual(['a-2']);
    expect(inProgress.totalCount).toBe(4);

    // done untouched.
    const done = page.groups.find((g) => g.key === 'done')!;
    expect(done.itemIds).toEqual(['b-1']);
    expect(done.totalCount).toBe(3);
  });

  it('rollback restores grouped cache', () => {
    const items = [mockTaskItem('a-1', 'in_progress')];
    const groups = [buildGroup('in_progress', ['a-1'], 1, 0)];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    const tx = removeSoupEntities(new Set(['a-1']));
    tx.rollback();

    const restored =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    expect(restored.pages[0].items['a-1']).toBeDefined();
    expect(restored.pages[0].groups[0].itemIds).toEqual(['a-1']);
    expect(restored.pages[0].groups[0].totalCount).toBe(1);
  });
});

describe('optimisticUpdateSoupEntity — cross-group move', () => {
  it('moves item id between groups via itemIds mutations only', () => {
    const items = [
      mockTaskItem('a-1', 'in_progress'),
      mockTaskItem('a-2', 'in_progress'),
      mockTaskItem('b-1', 'done'),
    ];
    const groups = [
      buildGroup('in_progress', ['a-1', 'a-2'], 5, 0),
      buildGroup('done', ['b-1'], 3, 1),
    ];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    // Simulate what normy would do during the merge: the canonical entity
    // (status now `done`) is what reconcile reads from normy's store.
    const merged = mockTaskItem('a-1', 'done');
    mockNormalizer.getObjectById.mockReturnValue(merged);
    // The cache itself also reflects the merge — apply via setQueryData so
    // TanStack Query sees the new reference rather than mutating in place.
    const cached =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    testQueryClient.setQueryData<
      InfiniteData<SoupAstItemsGroupedPage, unknown>
    >(key, {
      ...cached,
      pages: cached.pages.map((p, i) =>
        i === 0 ? { ...p, items: { ...p.items, 'a-1': merged } } : p
      ),
    });

    optimisticUpdateSoupEntity({
      tag: 'document',
      data: { id: 'a-1' },
      frecency_score: 1,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    const after =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    const page = after.pages[0];

    expect(page.items['a-1']).toBeDefined();

    const inProgress = page.groups.find((g) => g.key === 'in_progress')!;
    const done = page.groups.find((g) => g.key === 'done')!;
    expect(inProgress.itemIds).toEqual(['a-2']);
    expect(inProgress.totalCount).toBe(4);
    expect(done.itemIds).toEqual(['a-1', 'b-1']);
    expect(done.totalCount).toBe(4);
  });

  it('no-op when grouping membership did not change', () => {
    const items = [mockTaskItem('a-1', 'in_progress')];
    const groups = [buildGroup('in_progress', ['a-1'], 1, 0)];
    const key = seedGroupedAstQuery(mockGroupedParentCache(items, groups));

    mockNormalizer.getObjectById.mockReturnValue(
      mockTaskItem('a-1', 'in_progress')
    );

    optimisticUpdateSoupEntity({
      tag: 'document',
      data: { id: 'a-1' },
      frecency_score: 1,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    const after =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!;
    expect(after.pages[0].groups[0].itemIds).toEqual(['a-1']);
    expect(after.pages[0].groups[0].totalCount).toBe(1);
  });
});

describe('optimisticUpdateSoupEntity — parent item filter gate', () => {
  it('does not bucket an entity that fails the query item filter', () => {
    const items = [mockTaskItem('a-1', 'in_progress')];
    const groups = [buildGroup('in_progress', ['a-1'], 1, 0)];
    const key = seedGroupedAstQueryWithFilter(
      mockGroupedParentCache(items, groups),
      (item) => item.tag !== 'emailThread'
    );

    mockNormalizer.getObjectById.mockReturnValue(mockEmailItem('e-1'));

    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id: 'e-1' },
      frecency_score: 1,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    const page =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!.pages[0];

    expect(page.items['e-1']).toBeUndefined();
    expect(page.groups.map((g) => g.key)).toEqual(['in_progress']);
    expect(page.groups.some((g) => g.itemIds.includes('e-1'))).toBe(false);
  });

  it('removes a previously-bucketed entity that now fails the filter', () => {
    const items = [mockTaskItem('a-1', 'in_progress'), mockEmailItem('e-1')];
    const groups = [
      buildGroup('in_progress', ['a-1'], 1, 0),
      buildGroup(NOT_SET_GROUP_KEY, ['e-1'], 1, 1),
    ];
    const key = seedGroupedAstQueryWithFilter(
      mockGroupedParentCache(items, groups),
      (item) => item.tag !== 'emailThread'
    );

    mockNormalizer.getObjectById.mockReturnValue(mockEmailItem('e-1'));

    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id: 'e-1' },
      frecency_score: 1,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    const page =
      testQueryClient.getQueryData<
        InfiniteData<SoupAstItemsGroupedPage, unknown>
      >(key)!.pages[0];

    expect(page.items['e-1']).toBeUndefined();
    const notSet = page.groups.find((g) => g.key === NOT_SET_GROUP_KEY)!;
    expect(notSet.itemIds).toEqual([]);
    expect(notSet.totalCount).toBe(0);
  });
});
