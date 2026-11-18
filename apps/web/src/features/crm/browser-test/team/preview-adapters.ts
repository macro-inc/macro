import type { storageServiceClient as Storage } from '@service-storage/client';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type { CompanyContactsFilter } from '../../context/crm-sources';
import { useCompanyContactsQuery } from '../../queries/company-contacts';
import { companyContactsPage } from '../company-contacts-page';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const analytics = { track() {} };
export async function invalidateCachedCrmContacts() {}
export const useCrmContext = () => ({
  createNavigation: () => ({ openWithSplit() {} }),
  openCreateContact() {},
  userId: () => 'user-1',
  isTeamAdmin: () => () => role() !== 'member',
  createCompanyContactsSource: (
    filter: Accessor<CompanyContactsFilter | undefined>
  ) => useCompanyContactsQuery(deps, filter),
});

const CONTACT: CrmContactResponse = {
  id: 'visible-contact',
  companyId: 'company-1',
  name: 'Visible person',
  email: 'visible@example.com',
  hidden: false,
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  firstInteraction: '2026-10-15',
  lastInteraction: '2026-10-15',
};
let contacts: CrmContactResponse[] = [
  CONTACT,
  {
    ...CONTACT,
    id: 'removed-contact',
    name: 'Removed person',
    email: 'removed@example.com',
    hidden: true,
  },
  {
    ...CONTACT,
    id: 'unfiled-contact',
    name: 'Unfiled person',
    email: 'unfiled@example.com',
    companyId: null,
  },
];
// `?many` gives the company enough people to fill three Team pages.
if (new URLSearchParams(location.search).has('many'))
  contacts = contacts.concat(
    Array.from({ length: 120 }, (_, index) => {
      const number = String(index + 1).padStart(3, '0');
      return {
        ...CONTACT,
        id: `person-${number}`,
        name: `Person ${number}`,
        email: `person${number}@example.com`,
      };
    })
  );
export const [role, setRole] = createSignal('admin');
export const [failNext, setFailNext] = createSignal(false);
export const [companyReads, setCompanyReads] = createSignal(0);
export const [teamReads, setTeamReads] = createSignal(0);
export const [writes, setWrites] = createSignal(0);

export const storageServiceClient = {
  async getCompany({ includeContacts = true }) {
    setCompanyReads((count) => count + 1);
    const company: CrmCompanyResponse = {
      id: 'company-1',
      name: 'Example company',
      teamId: 'team-1',
      hidden: false,
      emailSync: false,
      domains: [],
      createdAt: '2026-10-15',
      updatedAt: '2026-10-15',
      contacts: includeContacts
        ? contacts.filter(
            (contact) =>
              contact.companyId === 'company-1' &&
              (role() !== 'member' || !contact.hidden)
          )
        : [],
    };
    return ok(company);
  },
  async listCompanyContactsPage({ companyId, ...params }) {
    setTeamReads((count) => count + 1);
    return ok(
      companyContactsPage(
        contacts,
        { id: companyId, hidden: false },
        role() !== 'member',
        params
      )
    );
  },
  async getContact({ contactId }) {
    const contact = contacts.find((item) => item.id === contactId);
    if (!contact || (role() === 'member' && contact.hidden))
      return err([{ code: 'NOT_FOUND', message: 'Not found' }]);
    return ok(contact);
  },
  async setContactHidden({ contactId, hidden }) {
    if (role() === 'member' || failNext()) {
      setFailNext(false);
      return err([
        { code: 'FORBIDDEN', message: 'Visibility update rejected' },
      ]);
    }
    setWrites((count) => count + 1);
    contacts = contacts.map((contact) =>
      contact.id === contactId ? { ...contact, hidden } : contact
    );
    return ok(undefined);
  },
} satisfies Pick<
  typeof Storage,
  'getCompany' | 'listCompanyContactsPage' | 'getContact' | 'setContactHidden'
>;

export const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
export const deps = {
  client,
  storage: storageServiceClient as unknown as typeof Storage,
};

export const prepareCrmVisibilityWrite = () => ({
  isCurrent: () => true,
  async commit() {},
});
