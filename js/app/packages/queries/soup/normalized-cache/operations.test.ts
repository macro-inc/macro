/**
 * @vitest-environment jsdom
 */

import type { InfiniteData } from '@tanstack/solid-query';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { SoupPage } from '@service-storage/generated/schemas/soupPage';
import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
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
}));

// biome-ignore lint/correctness/noPrivateImports: testing private export
import { buildSingleEntityFilter } from './operations';
import {
  getSoupItemId,
  insertSoupEntity,
  removeSoupEntities,
  removeSearchEntities,
  optimisticUpdateSoupItemUpdatedAt,
  optimisticUpdateSoupEntity,
} from './operations';
import { soupKeys } from '../keys';

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

const soupSeedKey = [...soupKeys.astItems._def, 'seed'];
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
    ].filter((k) => k !== filterKey);

    for (const key of otherFilters) {
      const ids = Object.values((filter as any)[key])[0];
      expect(ids).toEqual([NIL_ID]);
    }
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
