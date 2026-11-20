import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { isSnippetEntity, type SnippetEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  QUICK_ACCESS_FEED_OPTIONS,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo } from 'solid-js';

/** Snippet documents only, recently opened first. */
export const QUICK_ACCESS_SNIPPETS_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'viewed_updated' },
  body: compileToAst(
    queryStateFrom(defineQueryFilters({ include: { subType: ['snippet'] } }))
  ),
};

/**
 * Quick Access feed of all snippets the user can access — their own plus
 * team-shared ones.
 *
 * This is the parallel live source feeding the `'snippet'` bucket — the
 * recently-viewed history feed only covers snippets the user has opened,
 * this one widens the pool so the `;` menu lists team snippets the user has
 * never opened.
 */
export function useQuickAccessSnippetsQuery() {
  const query = useSoupAstItemsQuery(
    () => QUICK_ACCESS_SNIPPETS_ARGS,
    () => QUICK_ACCESS_FEED_OPTIONS
  );

  const snippets = createMemo<SnippetEntity[]>(() =>
    queryReadyGate(query) ? query.data.entities.filter(isSnippetEntity) : []
  );

  return { query, snippets };
}
