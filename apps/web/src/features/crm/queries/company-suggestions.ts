import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { type CrmCompanyEntity, isCrmCompanyEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import type {
  SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

/** Every visible CRM company, recently opened first. */
export const QUICK_ACCESS_CRM_COMPANIES_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'viewed_updated' },
  body: compileToAst(
    queryStateFrom(defineQueryFilters({}, { skipTargets: ['ccf'] }))
  ),
};

/**
 * Quick Access feed of the team's CRM companies, sorted so the user's
 * recently-opened ones bubble to the top (`viewed_updated` =
 * `COALESCE(UserHistory."updatedAt", crm_companies.last_interaction)`).
 *
 * This is the parallel live source feeding the `'crm_company'` bucket
 * — the recently-viewed soup query covers viewed companies with their
 * `viewedAt`, this one widens the pool to all team companies up to a
 * cap so users can `@`-mention companies they've never opened.
 */
export function useQuickAccessCrmCompaniesQuery(
  useSource: typeof useSoupAstItemsQuery,
  enabled: Accessor<boolean>
) {
  const query = useSource(
    () => QUICK_ACCESS_CRM_COMPANIES_ARGS,
    () => ({ enabled: enabled() })
  );

  const companies = createMemo<CrmCompanyEntity[]>(() =>
    enabled() && queryReadyGate(query)
      ? query.data.entities.filter(
          (entity): entity is CrmCompanyEntity =>
            isCrmCompanyEntity(entity) && !entity.hidden
        )
      : []
  );

  return { query, companies };
}
