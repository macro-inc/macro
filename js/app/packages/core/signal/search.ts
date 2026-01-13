import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import { searchClient } from '@service-search/client';
import type { UnifiedSearchResponse } from '@service-search/generated/models/unifiedSearchResponse';
import { makeAbortable } from '@solid-primitives/resource';
import { createMemo, createResource } from 'solid-js';

// TODO: would be nice to rework things to all use createSearchResource again... sigh
export function createUnifiedSearchResource(
  searchTerm: () => string,
  cursor: () => string | null = () => null
) {
  const combined = () => [searchTerm(), cursor()] as const;
  const [signal, , filterError] = makeAbortable();

  return createResource(combined, async ([term, cursorValue]) => {
    if (!ENABLE_SEARCH_SERVICE) return null;
    if (term.length < 3) return null;

    try {
      const result = await searchClient.search(
        {
          request: {
            search_on: 'content',
            match_type: 'partial',
            terms: [term],
            filters: {
              channel: {},
              chat: {},
              document: {},
              email: {},
              project: {},
            },
          },
          params: { cursor: cursorValue, page_size: 10 },
        },
        { signal: signal() }
      );
      if (isErr(result)) {
        console.error('Failed to get search query');
        return null;
      }
      const [, data] = result;
      return data;
    } catch (err) {
      filterError(err);
      return null;
    }
  });
}

export function useSearch(
  searchTerm: () => string,
  cursor: () => string | null = () => null
) {
  const [resource] = createUnifiedSearchResource(searchTerm, cursor);
  return createMemo((): UnifiedSearchResponse | undefined => {
    const latest = resource?.latest;
    if (!latest) return undefined;
    return latest;
  });
}
