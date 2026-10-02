import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { isGithubPrEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { queryReadyGate } from '../gate';
import { useSoupItemsQuery } from './items';

/** Accessible pull requests, using the same live feed as the PR list. */
export function useSlashMenuPullRequests(enabled: Accessor<boolean>) {
  const query = useSoupItemsQuery(
    () => ({
      params: { limit: 500, sort_method: 'viewed_updated' },
      body: {
        ...QUERY_FILTERS_BASE,
        foreign_entity_filters: {
          foreign_entity_sources: ['github_pull_request'],
        },
      },
    }),
    () => ({ enabled: enabled(), staleTime: 60_000 })
  );
  const pullRequests = createMemo(() =>
    queryReadyGate(query) ? query.data.filter(isGithubPrEntity) : []
  );
  return { query, pullRequests };
}
