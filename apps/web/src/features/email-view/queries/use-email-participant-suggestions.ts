import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { parseDomain } from '@core/util/domain';
import * as EmailValidator from 'email-validator';
import { type Accessor, createMemo } from 'solid-js';

/** Someone or something a view can match, as a suggestion. */
export type EmailParticipantSuggestion =
  | {
      type: 'domain';
      domain: string;
      /** The CRM company that owns the domain. */
      company?: string;
      /** How many of the viewer's contacts use it. */
      contacts?: number;
    }
  | { type: 'address'; email: string; name?: string };

/** More would only slow filtering; the field shows the best few matches. */
const MAX_CONTACT_DOMAINS = 300;

/**
 * Companies first, then people: the team's CRM companies (when CRM is on),
 * the domains of the viewer's contacts, most used first, then the contacts.
 */
export function useEmailParticipantSuggestions(): Accessor<
  EmailParticipantSuggestion[]
> {
  const { users } = useCombinedRecipients(['user']);
  const crm = useQuickAccessCrmCompaniesQuery();

  const people = createMemo(() => {
    const seen = new Set<string>();
    return users().flatMap((user) => {
      const email = user.data.email.trim().toLowerCase();
      if (seen.has(email) || !EmailValidator.validate(email)) return [];
      seen.add(email);
      const name = user.data.name?.trim();
      return [{ email, name: name && name !== email ? name : undefined }];
    });
  });

  return createMemo(() => {
    const companies = crm.companies().flatMap((company) =>
      company.domains.flatMap((entry) => {
        const domain = parseDomain(entry.domain);
        return domain
          ? [{ type: 'domain' as const, domain, company: company.name }]
          : [];
      })
    );
    const named = new Set(companies.map((suggestion) => suggestion.domain));
    const counts = new Map<string, number>();
    for (const person of people()) {
      const domain = parseDomain(person.email);
      if (domain && !named.has(domain))
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    const domains = [...counts]
      .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
      .slice(0, MAX_CONTACT_DOMAINS)
      .map(([domain, contacts]) => ({
        type: 'domain' as const,
        domain,
        contacts,
      }));
    const addresses = people()
      .map((person) => ({ type: 'address' as const, ...person }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
    return [...companies, ...domains, ...addresses];
  });
}
