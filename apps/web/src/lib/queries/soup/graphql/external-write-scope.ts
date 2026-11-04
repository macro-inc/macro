import { NIL } from 'uuid';
import type {
  GraphqlCrmCompanyExpr,
  GraphqlCrmContactExpr,
  GraphqlEntityFilterAst,
} from '../../../service-clients/service-storage/graphql/generated/graphql';

// Query observers compare context values by identity; preserve it across UI updates.
const NO_TYPES: readonly string[] = [];
const COMPANY_TYPES = ['GraphqlSoupCrmCompany'] as const;
const CONTACT_TYPES = ['GraphqlSoupCrmContact'] as const;
const CRM_TYPES = [...COMPANY_TYPES, ...CONTACT_TYPES] as const;

function excludesCrmRecords(
  filter: GraphqlCrmCompanyExpr | GraphqlCrmContactExpr | null | undefined
): boolean {
  if (filter?.and)
    return (
      excludesCrmRecords(filter.and.left) ||
      excludesCrmRecords(filter.and.right)
    );
  if (filter?.or)
    return (
      excludesCrmRecords(filter.or.left) && excludesCrmRecords(filter.or.right)
    );
  return filter?.literal?.id === NIL;
}

/** Use the initial scope for every page; opaque continuation cursors omit filters. */
export function crmExternalWriteTypes(
  filters: GraphqlEntityFilterAst | null | undefined
): readonly string[] {
  const companies = !excludesCrmRecords(filters?.crmCompanyFilter);
  // Contacts are opt-in, unlike companies in a general Soup list.
  const contacts =
    filters?.crmContactFilter && !excludesCrmRecords(filters.crmContactFilter);
  if (companies && contacts) return CRM_TYPES;
  if (companies) return COMPANY_TYPES;
  if (contacts) return CONTACT_TYPES;
  return NO_TYPES;
}
