import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { InitiativeEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  QUICK_ACCESS_FEED_OPTIONS,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo } from 'solid-js';

/**
 * Initiatives only, recently opened first. Initiatives are opt-in server-side
 * and have no filter field, so the include literal is written directly.
 */
export const QUICK_ACCESS_INITIATIVES_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'viewed_updated' },
  body: {
    ...compileToAst(queryStateFrom(defineQueryFilters({}))),
    if: { l: 'inc' },
  },
};

/**
 * Quick Access feed of the task projects (initiatives) the user can access.
 *
 * Projects never appear in history, so this is the only source feeding the
 * `'initiative'` bucket — mention menus and entity pickers list them like any
 * other entity.
 */
export function useQuickAccessInitiativesQuery() {
  const query = useSoupAstItemsQuery(
    () => QUICK_ACCESS_INITIATIVES_ARGS,
    () => QUICK_ACCESS_FEED_OPTIONS
  );

  const initiatives = createMemo<InitiativeEntity[]>(() =>
    queryReadyGate(query)
      ? query.data.entities.filter(
          (entity): entity is InitiativeEntity => entity.type === 'initiative'
        )
      : []
  );

  return { query, initiatives };
}
