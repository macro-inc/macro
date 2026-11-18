import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { isSkillEntity, type SkillEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  QUICK_ACCESS_FEED_OPTIONS,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo } from 'solid-js';

/** Skill documents only, recently opened first. */
export const QUICK_ACCESS_SKILLS_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'viewed_updated' },
  body: compileToAst(
    queryStateFrom(defineQueryFilters({ include: { subType: ['skill'] } }))
  ),
};

/**
 * Quick Access feed of all skills the user can access — their own plus
 * shared ones.
 *
 * This is the parallel live source feeding the `'skill'` bucket — the
 * recently-viewed history feed only covers skills the user has opened,
 * this one widens the pool so the `/` menu lists shared skills the user has
 * never opened.
 */
export function useQuickAccessSkillsQuery() {
  const query = useSoupAstItemsQuery(
    () => QUICK_ACCESS_SKILLS_ARGS,
    () => QUICK_ACCESS_FEED_OPTIONS
  );

  const skills = createMemo<SkillEntity[]>(() =>
    queryReadyGate(query) ? query.data.entities.filter(isSkillEntity) : []
  );

  return { query, skills };
}
