import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { t } from '@app/lib/i18n';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { parseDomain } from '@core/util/domain';
import type { ChipComboboxOption } from '@ui';
import { type Accessor, createMemo } from 'solid-js';

/** More would only slow filtering; the field shows the best few matches. */
const MAX_CONTACT_DOMAINS = 300;

/**
 * Domains a view could match: the team's CRM companies by name, when CRM is
 * on, then the domains of the viewer's contacts, most used first.
 */
export function useEmailDomainSuggestions(): Accessor<ChipComboboxOption[]> {
  const { users } = useCombinedRecipients(['user']);
  const crm = useQuickAccessCrmCompaniesQuery();

  const contactCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const user of users()) {
      const domain = parseDomain(user.data.email);
      if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    return counts;
  });

  return createMemo(() => {
    const companies = crm.companies().flatMap((company) =>
      company.domains.flatMap((entry) => {
        const domain = parseDomain(entry.domain);
        return domain
          ? [{ value: domain, label: company.name, detail: domain }]
          : [];
      })
    );
    const named = new Set(companies.map((option) => option.value));
    const contacts = [...contactCounts()]
      .filter(([domain]) => !named.has(domain))
      .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
      .slice(0, MAX_CONTACT_DOMAINS)
      .map(([domain, count]) => ({
        value: domain,
        label: domain,
        detail: t('emailViews.domainContacts', { count }),
      }));
    return [...companies, ...contacts];
  });
}
