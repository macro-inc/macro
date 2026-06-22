import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import { isSnippetEntity, type SnippetEntity } from '@entity';
import { useSoupItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

const QUICK_ACCESS_SNIPPETS_LIMIT = 500;
const STALE_TIME = 5 * 60 * 1000;

/**
 * Quick Access feed of all snippets the user can access — their own plus
 * team-shared ones.
 *
 * This is the parallel live source feeding the `'snippet'` bucket — the
 * recently-viewed history feed only covers snippets the user has opened,
 * this one widens the pool so the `;` menu lists team snippets the user has
 * never opened.
 *
 * Every other entity type is filtered out by extending `QUERY_FILTERS_BASE`;
 * documents are narrowed to the snippet sub type.
 */
export function useQuickAccessSnippetsQuery() {
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });

  const query = useSoupItemsQuery(
    () => ({
      params: {
        limit: QUICK_ACCESS_SNIPPETS_LIMIT,
        sort_method: 'viewed_updated',
      },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { sub_types: ['snippet'] },
      },
    }),
    () => ({ staleTime: STALE_TIME, enabled: snippetsFlag().enabled })
  );

  const snippets = createMemo<SnippetEntity[]>(
    () => query.data?.filter(isSnippetEntity) ?? []
  );

  return { query, snippets };
}
