export { materializeCachedGraphqlCrmCompanies } from './queries/graphql';

import { useSoupItemsQuery } from '@queries/soup/items';
import { useQuickAccessCrmCompaniesQuery as createSuggestions } from './queries/company-suggestions';
export function useQuickAccessCrmCompaniesQuery() {
  return createSuggestions(useSoupItemsQuery, () => true);
}
