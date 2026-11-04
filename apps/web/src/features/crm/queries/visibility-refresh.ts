import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import type { Query, QueryClient } from '@tanstack/solid-query';
import { crmKeys } from './keys';
import { listCanIncludeCrm, listCanIncludeCrmContacts } from './list-refresh';

export type CrmVisibilityChange = {
  kind: 'company' | 'contact';
  id: string;
  hidden: boolean;
};

/** REST Soup and paginated suggestions are separate from the normalized cache. */
export function visibilityQueryFilter(change: CrmVisibilityChange) {
  return (query: Query): boolean => {
    const key = query.queryKey;
    if (key[0] !== 'soup') return false;
    if (key[1] === 'crmPeople') return true;
    if (key[1] === 'astItems')
      return change.kind === 'company'
        ? listCanIncludeCrm(key[3])
        : listCanIncludeCrmContacts(key[3]);
    if (key[1] === 'groupedGroup')
      return change.kind === 'company'
        ? listCanIncludeCrm(key[6])
        : listCanIncludeCrmContacts(key[6]);
    if (change.kind !== 'company') return false;
    let body = key[3];
    if (key[1] === 'search') {
      if (
        !body ||
        typeof body !== 'object' ||
        !('include_crm' in body) ||
        body.include_crm !== true
      )
        return false;
      body = 'filters' in body ? body.filters : undefined;
    } else if (key[1] !== 'items') return false;
    if (
      typeof body !== 'object' ||
      body === null ||
      !('crm_company_filters' in body)
    )
      return true;
    const filter = body.crm_company_filters;
    if (
      typeof filter !== 'object' ||
      filter === null ||
      !('company_ids' in filter)
    )
      return true;
    return (
      !Array.isArray(filter.company_ids) ||
      !filter.company_ids.length ||
      filter.company_ids.includes(change.id)
    );
  };
}

/** Unknown detail responses may embed the affected record; known unrelated records stay warm. */
export function visibilityDetailsFilter(change: CrmVisibilityChange) {
  return (query: Query): boolean => {
    const key = query.queryKey;
    if (key[0] !== 'crm') return false;
    if (key[1] === 'contact' && change.kind === 'contact')
      return key[2] === change.id;
    const data = query.state.data;
    if (key[1] === 'company') {
      if (change.kind === 'company') return key[2] === change.id;
      if (
        !data ||
        typeof data !== 'object' ||
        !('contacts' in data) ||
        !Array.isArray(data.contacts)
      )
        return true;
      return data.contacts.some((contact) => contact.id === change.id);
    }
    if (key[1] !== 'contact' && key[1] !== 'contactByEmail') return false;
    if (!data || typeof data !== 'object') return true;
    return change.kind === 'contact'
      ? 'id' in data && data.id === change.id
      : 'companyId' in data && data.companyId === change.id;
  };
}

/** Apply only confirmed facts, before a background read can render an old row. */
export async function updateVisibilityDetails(
  client: QueryClient,
  change: CrmVisibilityChange,
  isCurrent: () => boolean = () => true
) {
  await Promise.all([
    client.cancelQueries({ predicate: visibilityDetailsFilter(change) }),
    client.cancelQueries({ predicate: visibilityQueryFilter(change) }),
  ]);
  if (!isCurrent()) return;
  client.setQueriesData({ predicate: visibilityQueryFilter(change) }, (data) =>
    patchVisibilitySnapshot(data, change)
  );
  const patchContact = (contact: CrmContactResponse | undefined) => {
    if (!contact) return contact;
    if (
      change.kind === 'contact'
        ? contact.id !== change.id
        : contact.companyId !== change.id
    )
      return contact;
    return { ...contact, hidden: change.hidden };
  };
  client.setQueriesData<CrmContactResponse>(
    { queryKey: crmKeys.contact._def },
    patchContact
  );
  client.setQueriesData<CrmContactResponse | null>(
    { queryKey: crmKeys.contactByEmail._def },
    (contact) => (contact ? patchContact(contact) : contact)
  );
  client.setQueriesData<CrmCompanyResponse>(
    { queryKey: crmKeys.company._def },
    (company) => {
      if (!company) return company;
      const contacts = company.contacts.map(
        (contact) => patchContact(contact)!
      );
      if (change.kind === 'company' && company.id === change.id)
        return {
          ...company,
          contacts,
          hidden: change.hidden,
          emailSync: change.hidden ? false : company.emailSync,
        };
      return contacts.some(
        (contact, index) => contact !== company.contacts[index]
      )
        ? { ...company, contacts }
        : company;
    }
  );
}

/** Preserve page/cursor structure while patching CRM records in legacy query snapshots. */
export function patchVisibilitySnapshot(
  data: unknown,
  change: CrmVisibilityChange,
  recordType?: 'company' | 'contact'
): unknown {
  if (Array.isArray(data))
    return data.map((value) => patchVisibilitySnapshot(value, change));
  if (typeof data !== 'object' || data === null || data instanceof Date)
    return data;
  let kind = recordType;
  if ('__typename' in data) {
    if (data.__typename === 'GraphqlSoupCrmCompany') kind = 'company';
    if (data.__typename === 'GraphqlSoupCrmContact') kind = 'contact';
  }
  if ('type' in data) {
    if (data.type === 'crm_company' || data.type === 'company')
      kind = 'company';
    if (data.type === 'crm_contact') kind = 'contact';
  }
  const parent =
    'contactCompanyId' in data
      ? data.contactCompanyId
      : 'companyId' in data
        ? data.companyId
        : undefined;
  const affected =
    kind &&
    'id' in data &&
    ((change.kind === kind && data.id === change.id) ||
      (change.kind === 'company' &&
        kind === 'contact' &&
        parent === change.id));
  const childKind =
    'tag' in data && data.tag === 'crmCompany'
      ? 'company'
      : 'tag' in data && data.tag === 'crmContact'
        ? 'contact'
        : undefined;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      affected && key === 'hidden'
        ? change.hidden
        : patchVisibilitySnapshot(
            value,
            change,
            key === 'data' ? childKind : undefined
          ),
    ])
  );
}
