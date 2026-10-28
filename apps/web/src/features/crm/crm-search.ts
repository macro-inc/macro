export { materializeCachedGraphqlCrmCompanies } from './queries/graphql';

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useQuickAccessCrmCompaniesQuery as createSuggestions } from './queries/company-suggestions';
export function useQuickAccessCrmCompaniesQuery() {
  const flag = useFeatureFlag(enableCrm);
  return createSuggestions(useSoupItemsQuery, () => flag().enabled);
}
