import type { CompanyContactsPageResponse } from '@service-storage/generated/schemas/companyContactsPageResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import type { ListCompanyContactsPageParams } from '@service-storage/generated/schemas/listCompanyContactsPageParams';

/**
 * `GET /crm/companies/{id}/contacts/page` over a fixture's contacts: the
 * server's filter and order (name, else email, ignoring case; ties by id
 * descending), with an offset for a cursor.
 */
export function companyContactsPage(
  contacts: CrmContactResponse[],
  company: { id: string; hidden: boolean },
  admin: boolean,
  params: ListCompanyContactsPageParams
): CompanyContactsPageResponse {
  const search = params.query?.trim().toLowerCase() ?? '';
  const sortName = (contact: CrmContactResponse) =>
    (contact.name ?? contact.email)?.toLowerCase();
  const rows = contacts
    .filter(
      (contact) =>
        contact.companyId === company.id &&
        (admin || !contact.hidden) &&
        (contact.hidden || company.hidden) === !!params.archived &&
        (!search ||
          !!contact.name?.toLowerCase().includes(search) ||
          !!contact.email?.toLowerCase().includes(search))
    )
    .sort((a, b) => {
      const [left, right] = [sortName(a), sortName(b)];
      if (left !== right) {
        if (left === undefined) return 1;
        if (right === undefined) return -1;
        return left < right ? -1 : 1;
      }
      return a.id < b.id ? 1 : -1;
    });
  const offset = Number(params.cursor ?? 0);
  const limit = params.limit ?? 50;
  const end = offset + limit;
  return {
    contacts: rows.slice(offset, end).map((contact) => ({ ...contact })),
    nextCursor: end < rows.length ? String(end) : null,
  };
}
