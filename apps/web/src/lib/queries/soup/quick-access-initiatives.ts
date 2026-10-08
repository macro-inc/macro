import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import type { InitiativeEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useSoupItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

const QUICK_ACCESS_INITIATIVES_LIMIT = 500;
const STALE_TIME = 5 * 60 * 1000;

/**
 * Quick Access feed of the task projects (initiatives) the user can access.
 *
 * Projects never appear in history, so this is the only source feeding the
 * `'initiative'` bucket — mention menus and entity pickers list them like any
 * other entity.
 *
 * Every other entity type is filtered out by extending `QUERY_FILTERS_BASE`;
 * initiatives are opt-in.
 */
export function useQuickAccessInitiativesQuery() {
  const projectsFlag = useFeatureFlag(enableProjects);

  const query = useSoupItemsQuery(
    () => ({
      params: {
        limit: QUICK_ACCESS_INITIATIVES_LIMIT,
        sort_method: 'viewed_updated',
      },
      body: {
        ...QUERY_FILTERS_BASE,
        initiative_filters: { include: true },
      },
    }),
    () => ({ staleTime: STALE_TIME, enabled: projectsFlag().enabled })
  );

  const initiatives = createMemo<InitiativeEntity[]>(() =>
    queryReadyGate(query)
      ? query.data.filter(
          (entity): entity is InitiativeEntity => entity.type === 'initiative'
        )
      : []
  );

  return { query, initiatives };
}
