import { useCompanyQuery } from '@queries/crm/companies';
import { useCrmCompanyIdForDomainQuery } from '@queries/crm/company-for-domain';
import type { Accessor } from 'solid-js';

/**
 * The caller's team CRM company for an email domain, with its contacts.
 *
 * Two hops — domain → company id (unified search), then id → company +
 * contacts — both cached by TanStack Query, so cards in different panels that
 * share one domain issue one pair of requests between them.
 */
export function useCrmCompanyForDomain(domain: Accessor<string | undefined>) {
  const companyIdQuery = useCrmCompanyIdForDomainQuery(domain);
  const companyId = () => companyIdQuery.data ?? '';
  const { query, company, contacts } = useCompanyQuery(companyId);

  return {
    company,
    contacts,
    /** True while either hop is still in flight. */
    isLoading: () =>
      companyIdQuery.isLoading || (!!companyId() && query.isLoading),
  };
}
