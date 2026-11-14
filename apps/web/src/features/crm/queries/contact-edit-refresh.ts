import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import type { Query, QueryClient } from '@tanstack/solid-query';
import { contactEmails } from '../core/contact';
import { crmKeys } from './keys';

/** Whether two snapshots agree on the fields a contact edit owns. */
export function sameContactIdentity(
  a: CrmContactResponse | undefined,
  b: CrmContactResponse
): boolean {
  if (!a) return false;
  return (
    a.email === b.email &&
    a.companyId === b.companyId &&
    contactEmails(a).join('\n') === contactEmails(b).join('\n')
  );
}

/** Only detail records and address lookups affected by this committed edit. */
export function contactEditDetailsFilter(
  client: QueryClient,
  before: CrmContactResponse,
  after: CrmContactResponse
) {
  const current = client.getQueryData<CrmContactResponse>(
    crmKeys.contact(after.id).queryKey
  );
  const companyIds = new Set([
    before.companyId,
    current?.companyId,
    after.companyId,
  ]);
  const emails = new Set<string | null | undefined>([
    before.email,
    current?.email,
    after.email,
    ...contactEmails(before),
    ...(current ? contactEmails(current) : []),
    ...contactEmails(after),
  ]);
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: crmKeys.company._def })) {
    const company = query.state.data as CrmCompanyResponse | undefined;
    if (company?.contacts?.some((contact) => contact.id === after.id))
      companyIds.add(company.id);
  }
  return (query: Query): boolean => {
    const key = query.queryKey;
    if (key[0] !== 'crm') return false;
    if (key[1] === 'contact') return key[2] === after.id;
    if (key[1] === 'company')
      return typeof key[2] === 'string' && companyIds.has(key[2]);
    if (key[1] !== 'contactByEmail') return false;
    const data = query.state.data;
    return (
      (typeof key[3] === 'string' && emails.has(key[3])) ||
      (!!data &&
        typeof data === 'object' &&
        'id' in data &&
        data.id === after.id)
    );
  };
}

/** Cancel pre-save reads, then publish confirmed fields without changing record identity. */
export async function updateContactEditDetails(
  client: QueryClient,
  before: CrmContactResponse,
  after: CrmContactResponse,
  isCurrent: () => boolean,
  predicate = contactEditDetailsFilter(client, before, after)
) {
  await client.cancelQueries({ predicate });
  if (!isCurrent()) return false;
  const key = crmKeys.contact(after.id).queryKey;
  const current = client.getQueryData<CrmContactResponse>(key);
  // updatedAt is a transaction-start timestamp, not a commit version. Only
  // patch a snapshot whose editable fields still match the caller or response;
  // conflicting fields require an authoritative refresh instead.
  if (
    current &&
    !sameContactIdentity(current, before) &&
    !sameContactIdentity(current, after)
  )
    return false;
  // Email/company edits do not own names or visibility. In particular, the
  // archive endpoint returns no timestamp, so a newer archive can share the
  // old detail timestamp while this response is still in flight.
  const patch = (record: CrmContactResponse) => ({
    ...record,
    email: after.email,
    emails: after.emails,
    personalEmail: after.personalEmail,
    companyId: after.companyId,
    companyDomain: after.companyDomain,
    companyDomainEmails: after.companyDomainEmails,
    updatedAt: after.updatedAt,
  });
  const confirmed = patch(current ?? before);
  client.setQueryData(key, confirmed);
  client.setQueriesData<CrmCompanyResponse>(
    { queryKey: crmKeys.company._def },
    (company) => {
      if (!company) return company;
      if (
        company.id !== after.companyId &&
        !company.contacts.some((contact) => contact.id === after.id)
      )
        return company;
      const contacts = company.contacts.filter(
        (contact) => contact.id !== after.id
      );
      if (company.id === after.companyId) contacts.push(confirmed);
      return { ...company, contacts };
    }
  );
  // A lookup is keyed by the address it resolved. It keeps naming this contact
  // only while the contact still holds that address.
  const held = new Set(contactEmails(after));
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: crmKeys.contactByEmail._def, predicate })) {
    const contact = query.state.data as CrmContactResponse | null | undefined;
    if (contact?.id !== after.id) continue;
    const address = query.queryKey[3];
    client.setQueryData(
      query.queryKey,
      typeof address === 'string' && held.has(address) ? patch(contact) : null
    );
  }
  await client.invalidateQueries({ predicate, refetchType: 'none' });
  return isCurrent();
}
