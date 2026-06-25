import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { ENABLE_CRM } from '@core/constant/featureFlags';
import { type CrmCompanyEntity, isCrmCompanyEntity } from '@entity';
import { useSoupItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

const QUICK_ACCESS_COMPANIES_LIMIT = 500;
const STALE_TIME = 5 * 60 * 1000;

/**
 * Quick Access feed of the team's CRM companies, sorted so the user's
 * recently-opened ones bubble to the top (`viewed_updated` =
 * `COALESCE(UserHistory."updatedAt", crm_companies.last_interaction)`).
 *
 * This is the parallel live source feeding the `'crm_company'` bucket
 * — the recently-viewed soup query covers viewed companies with their
 * `viewedAt`, this one widens the pool to all team companies up to a
 * cap so users can `@`-mention companies they've never opened.
 *
 * Every other entity type is filtered out by extending `QUERY_FILTERS_BASE`.
 */
export function useQuickAccessCrmCompaniesQuery() {
  const query = useSoupItemsQuery(
    () => ({
      params: {
        limit: QUICK_ACCESS_COMPANIES_LIMIT,
        sort_method: 'viewed_updated',
      },
      body: {
        ...QUERY_FILTERS_BASE,
        // crm_company_filters intentionally unset = all visible companies
        crm_company_filters: undefined,
      },
    }),
    () => ({ staleTime: STALE_TIME, enabled: ENABLE_CRM })
  );

  const companies = createMemo<CrmCompanyEntity[]>(
    () => query.data?.filter(isCrmCompanyEntity) ?? []
  );

  return { query, companies };
}
