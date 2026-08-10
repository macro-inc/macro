import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { isSkillEntity, type SkillEntity } from '@entity';
import { useSoupItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

const QUICK_ACCESS_SKILLS_LIMIT = 500;
const STALE_TIME = 5 * 60 * 1000;

/**
 * Quick Access feed of all skills the user can access — their own plus
 * shared ones.
 *
 * This is the parallel live source feeding the `'skill'` bucket — the
 * recently-viewed history feed only covers skills the user has opened,
 * this one widens the pool so the `/` menu lists shared skills the user has
 * never opened.
 *
 * Every other entity type is filtered out by extending `QUERY_FILTERS_BASE`;
 * documents are narrowed to the skill sub type.
 */
export function useQuickAccessSkillsQuery() {
  const query = useSoupItemsQuery(
    () => ({
      params: {
        limit: QUICK_ACCESS_SKILLS_LIMIT,
        sort_method: 'viewed_updated',
      },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { sub_types: ['skill'] },
      },
    }),
    () => ({ staleTime: STALE_TIME })
  );

  const skills = createMemo<SkillEntity[]>(
    () => query.data?.filter(isSkillEntity) ?? []
  );

  return { query, skills };
}
