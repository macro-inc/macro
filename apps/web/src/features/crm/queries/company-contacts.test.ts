import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { expect, it } from 'vitest';
import {
  companyContactsHold,
  isCompanyContactsQuery,
  patchCompanyContacts,
} from './company-contacts';
import { crmKeys } from './keys';

const contact = (id: string, companyId: string): CrmContactResponse => ({
  id,
  companyId,
  name: id,
  hidden: false,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
});
const teamKey = (companyId: string, archived = false, search = '') => [
  ...crmKeys.companyContacts(companyId).queryKey,
  archived,
  search,
];
const pages = (...rows: CrmContactResponse[][]) => ({
  pages: rows.map((contacts, index) => ({
    contacts,
    nextCursor: index < rows.length - 1 ? `cursor-${index}` : null,
    search: '',
  })),
  pageParams: rows.map((_, index) => (index ? `cursor-${index - 1}` : null)),
});

it('recognizes a Team list by company', () => {
  expect(isCompanyContactsQuery(teamKey('company-1'))).toBe(true);
  expect(isCompanyContactsQuery(teamKey('company-1'), 'company-1')).toBe(true);
  expect(isCompanyContactsQuery(teamKey('company-1'), 'company-2')).toBe(false);
  expect(isCompanyContactsQuery(crmKeys.company('company-1').queryKey)).toBe(
    false
  );
  expect(companyContactsHold(pages([contact('a', 'c')]), 'a')).toBe(true);
  expect(companyContactsHold(pages([contact('a', 'c')]), 'b')).toBe(false);
  expect(companyContactsHold(undefined, 'a')).toBe(false);
});

it('patches and drops rows in every cached page, keeping untouched pages and cursors', () => {
  const client = new QueryClient();
  const first = [contact('a', 'company-1'), contact('b', 'company-1')];
  const second = [contact('c', 'company-1')];
  const other = pages([contact('d', 'company-2')]);
  client.setQueryData(teamKey('company-1'), pages(first, second));
  client.setQueryData(teamKey('company-2'), other);

  patchCompanyContacts(client, (row, companyId) => {
    if (row.id === 'a') return { ...row, name: `renamed in ${companyId}` };
    if (row.id === 'b') return undefined;
    return row;
  });

  const patched = client.getQueryData<ReturnType<typeof pages>>(
    teamKey('company-1')
  );
  expect(patched?.pages[0].contacts).toEqual([
    { ...first[0], name: 'renamed in company-1' },
  ]);
  expect(patched?.pages[0].nextCursor).toBe('cursor-0');
  expect(patched?.pages[1].contacts).toBe(second);
  expect(patched?.pageParams).toEqual([null, 'cursor-0']);
  expect(client.getQueryData(teamKey('company-2'))).toBe(other);
  client.clear();
});
