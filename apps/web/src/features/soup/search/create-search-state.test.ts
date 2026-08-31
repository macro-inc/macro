import type { EntityData, WithSearch } from '@entity';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useSearchSoupQuery = vi.hoisted(() => vi.fn());

vi.mock('./context', () => ({
  useOptionalSearchContext: () => undefined,
}));

vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery,
  validateSearchServiceText: (text: string) => text.length >= 3,
}));

import { createSearchState, soupSearchMatchType } from './create-search-state';

const entity = (id: string, name: string) =>
  ({ id, name, type: 'document' }) as EntityData;

const serviceEntity = (id: string, name: string) =>
  ({
    ...entity(id, name),
    search: {
      nameHighlight: name,
      senderHighlightTerms: null,
      contentHitData: null,
      source: 'service',
    },
  }) as WithSearch<EntityData>;

afterEach(() => useSearchSoupQuery.mockReset());

describe('createSearchState', () => {
  it('uses exact matching only for one fully quoted term', () => {
    expect(soupSearchMatchType('"quarterly plan"')).toBe('exact');
    expect(soupSearchMatchType('quarterly plan')).toBe('partial');
    expect(soupSearchMatchType('"quarterly" plan')).toBe('partial');
  });

  it('merges featured local matches with service results by entity id', () => {
    const remoteDuplicate = serviceEntity('2', 'Remote plan');
    let requestQuery = '';

    useSearchSoupQuery.mockImplementation(
      (request: () => SearchSoupQueryArgs) => {
        requestQuery = request().body.query;
        return {
          data: [serviceEntity('3', 'Service result'), remoteDuplicate],
          isLoading: false,
          isPlaceholderData: false,
          isFetching: false,
          error: undefined,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        };
      }
    );

    createRoot((dispose) => {
      const local = [entity('2', 'Plan'), entity('1', 'Planning notes')];
      const search = createSearchState({
        text: () => 'plan',
        localPool: () => local.map((data) => ({ data })),
        buildRequest: ({ query, matchType }) => ({
          params: { cursor: null, page_size: 100 },
          body: {
            query,
            match_type: matchType,
            search_on: 'name_content',
            filters: {},
          },
        }),
      });

      expect(requestQuery).toBe('plan');
      expect(search.data().map((item) => item.id)).toEqual(['2', '1', '3']);
      expect(search.data()[0]).toBe(remoteDuplicate);
      dispose();
    });
  });
});
