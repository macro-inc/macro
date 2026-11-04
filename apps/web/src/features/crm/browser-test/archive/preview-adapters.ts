import type { storageServiceClient as Storage } from '@service-storage/client';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import {
  useCompanyQuery,
  useSetCompanyHiddenMutation,
  useSetCompanyNameMutation,
  useSetEmailSyncMutation,
} from '../../queries/companies';
import {
  useContactQuery,
  useSetContactHiddenMutation,
  useSetContactNameMutation,
} from '../../queries/contacts';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const analytics = { track() {} };
export async function invalidateCachedCrmContacts() {}
// This fixture verifies REST/UI integration; normalized-cache fencing has separate exchange tests.
export const prepareCrmVisibilityWrite = () => ({
  isCurrent: () => true,
  async commit() {},
});
export const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
export const [role, setRole] = createSignal('admin');
export const [writes, setWrites] = createSignal(0);
export const [message, setMessage] = createSignal('');
let failNext = false;
let release: (() => void) | undefined;
let hold = false;
const params = new URLSearchParams(location.search);
let company: CrmCompanyResponse = {
  id: 'company-1',
  name: 'Example company',
  teamId: 'team-1',
  hidden: params.has('companyArchived'),
  emailSync: !params.has('companyArchived'),
  domains: [
    {
      id: 'domain-1',
      companyId: 'company-1',
      domain: 'example.com',
      createdAt: '2026-10-15',
    },
  ],
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  contacts: [],
};
let contacts: CrmContactResponse[] = ['Example person', 'Second person'].map(
  (name, index) => ({
    id: `contact-${index + 1}`,
    companyId: company.id,
    name,
    email: `person${index + 1}@example.com`,
    hidden: company.hidden || index === 1 || params.has('archived'),
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
    firstInteraction: '2026-10-15',
    lastInteraction: '2026-10-15',
  })
);
async function save() {
  setWrites((value) => value + 1);
  if (hold)
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  hold = false;
  if (failNext || role() === 'member') {
    failNext = false;
    return false;
  }
  return true;
}
export const storageServiceClient = {
  async getCompany() {
    return ok({
      ...company,
      contacts: contacts.map((contact) => ({ ...contact })),
    });
  },
  async getContact({ contactId }) {
    return ok({ ...contacts.find((contact) => contact.id === contactId)! });
  },
  async setContactHidden({ contactId, hidden }) {
    if (!(await save()))
      return err([{ code: 'FORBIDDEN', message: 'Save rejected' }]);
    contacts = contacts.map((contact) =>
      contact.id === contactId ? { ...contact, hidden } : contact
    );
    return ok(undefined);
  },
  async setCompanyHidden({ hidden }) {
    if (!(await save()))
      return err([{ code: 'FORBIDDEN', message: 'Save rejected' }]);
    company = {
      ...company,
      hidden,
      emailSync: hidden ? false : company.emailSync,
    };
    contacts = contacts.map((contact) => ({ ...contact, hidden }));
    return ok(undefined);
  },
  async setCompanyName({ name }) {
    company = { ...company, name };
    return ok(undefined);
  },
  async setContactName({ contactId, name }) {
    contacts = contacts.map((contact) =>
      contact.id === contactId ? { ...contact, name } : contact
    );
    return ok(undefined);
  },
  async setEmailSync({ emailSync }) {
    company = { ...company, emailSync };
    return ok(undefined);
  },
} satisfies Pick<
  typeof Storage,
  | 'getCompany'
  | 'getContact'
  | 'setCompanyHidden'
  | 'setContactHidden'
  | 'setCompanyName'
  | 'setContactName'
  | 'setEmailSync'
>;
const deps = {
  client,
  storage: storageServiceClient as unknown as typeof Storage,
};
export const useCrmContext = () => ({
  userId: () => 'user-1',
  isTeamAdmin: () => () => role() !== 'member',
  createCompanySource: (id: Accessor<string>) => useCompanyQuery(deps, id),
  createContactSource: (id: Accessor<string>) => useContactQuery(deps, id),
  hideCompany: () => useSetCompanyHiddenMutation(deps),
  hideContact: () => useSetContactHiddenMutation(deps),
  renameCompany: () => useSetCompanyNameMutation(deps),
  renameContact: () => useSetContactNameMutation(deps),
  setEmailSync: () => useSetEmailSyncMutation(deps),
  createNavigation: () => ({
    openWithSplit() {
      location.search = '?kind=company&companyArchived';
    },
  }),
  copyRecordLink: async () => true,
  contactInitials: (name: string) =>
    name
      .split(' ')
      .map((part) => part[0])
      .join(''),
  feedback: { success: setMessage, failure: setMessage },
  openCreateContact() {},
});
Object.assign(window, {
  archiveFixture: {
    failNext() {
      failNext = true;
    },
    holdNext() {
      hold = true;
    },
    release() {
      release?.();
    },
    setRole,
    writes,
    snapshot: () => ({ company, contacts }),
  },
});

export const useFeatureFlag = () => () => ({ enabled: true, loading: false });

declare global {
  interface Window {
    archiveFixture: {
      failNext(): void;
      holdNext(): void;
      release(): void;
      setRole(value: string): void;
      writes(): number;
      snapshot(): {
        company: CrmCompanyResponse;
        contacts: CrmContactResponse[];
      };
    };
  }
}
