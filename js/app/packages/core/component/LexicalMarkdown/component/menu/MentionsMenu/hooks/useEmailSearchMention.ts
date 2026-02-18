import type { Accessor } from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import type { EntityItem } from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
} from '@queries/soup/search';

export type UseEmailSearchMentionOptions = {
  searchTerm: Accessor<string>;
};

export type UseEmailSearchMentionResult = {
  emails: Accessor<EntityItem[]>;
  emailSearchQuery: ReturnType<typeof useSearchSoupQuery>;
};

/**
 * Hook for managing email mentions in the mentions menu with query-based search.
 */
export function useEmailSearchMention(
  options: UseEmailSearchMentionOptions
): UseEmailSearchMentionResult {
  const { searchTerm } = options;

  // Build search query args for remote email search
  const args = createLazyMemo((): SearchSoupQueryArgs => {
    return {
      params: {
        cursor: null,
        page_size: 10,
      },
      body: {
        match_type: 'partial',
        search_on: 'name',
        include: ['emails'],
        query: searchTerm(),
      },
    };
  });

  const emailSearchQuery = useSearchSoupQuery(args);

  const emailList = createLazyMemo((): EntityItem[] => {
    if (emailSearchQuery.status !== 'success') return [];
    return emailSearchQuery.data
      .filter((e) => e.type === 'email')
      .map(
        (e): EntityItem => ({
          kind: 'entity',
          id: e.id,
          bucket: 'email',
          searchText: e.name ?? 'No Subject',
          sortTimestamp: e.updatedAt ? new Date(e.updatedAt).getTime() : 0,
          timestamps: {
            updatedAt: e.updatedAt ?? null,
            createdAt: e.createdAt ?? null,
          },
          data: e as unknown as EntityItem['data'],
        })
      );
  });

  const emailSearch = createFreshSearch<EntityItem>(
    { timeWeight: 0, brevityWeight: 0.3 },
    (item) => item.searchText,
    (_item) => false,
    (item) => item.timestamps
  );

  const emails = createLazyMemo((): EntityItem[] => {
    const term = searchTerm();
    if (!term) return emailList();
    return emailSearch(emailList(), term).map(({ item }) => item);
  });

  return {
    emails,
    emailSearchQuery,
  };
}
