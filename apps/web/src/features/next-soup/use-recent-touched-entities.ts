import { soupItemMatchesListView } from '@app/constants/list-views';
import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store/compile';
import { getRecentFilters } from '@app/features/next-soup/sidebar/soup-filter-presets';
import type { EntityData } from '@entity';
import { type SoupAstBody, useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

/**
 * The first page of the touched-by-me feed, for merging into another view's
 * rows via `additionalEntities` (Flow = inbox Signal plus this). One page is
 * the deliberate scope: load-more belongs to the hosting view's own query,
 * and an older touch that has fallen off this page is by definition not
 * recent.
 */
export const useRecentTouchedEntities = (): Accessor<EntityData[]> => {
  const body = createMemo(
    () => compileToAst(queryStateFrom(getRecentFilters())) as SoupAstBody
  );
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'touched_by_me' },
      body: body(),
    }),
    () => ({
      // This query shares its key with the Recent view's, and TanStack meta
      // is last-writer-wins across observers — without an equivalent gate
      // here, mounting Flow would strip the Recent view's own-touch insert
      // gate and let teammates' websocket inserts into the touched feed.
      meta: {
        itemFilter: (item) => soupItemMatchesListView(item, 'recent'),
      },
    })
  );

  return () => query.data?.entities ?? [];
};
