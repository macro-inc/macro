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
  const query = useSoupAstItemsQuery(() => ({
    params: { limit: 100, sort_method: 'touched_by_me' },
    body: body(),
  }));

  return () => query.data?.entities ?? [];
};
