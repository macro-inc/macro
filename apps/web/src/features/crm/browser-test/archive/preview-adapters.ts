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
  useSetContactCompanyMutation,
  useSetContactEmailMutation,
} from '../../queries/contact-edit';
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
  async invalidate() {},
});
export const prepareCrmContactEdit = prepareCrmVisibilityWrite;
export const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
export const [selectedContact, selectContact] = createSignal('contact-1');
export const [role, setRole] = createSignal('admin');
export const [writes, setWrites] = createSignal(0);
export const [message, setMessage] = createSignal('');
let failNext = false;
let release: (() => void) | undefined;
let hold = false;
const params = new URLSearchParams(location.search);
let company: CrmCompanyResponse = {
  id: 'company-1',
  name: params.get('companyName') ?? 'Example company',
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
const PERSONAL_DOMAIN = 'gmail.com';
const domain = params.has('personal') ? PERSONAL_DOMAIN : 'example.com';
const isPersonal = (email: string | null | undefined) =>
  !!email?.endsWith(`@${PERSONAL_DOMAIN}`);
/** The identity fields the server derives from a contact's addresses. */
function identity(
  emails: string[],
  companyId: string | null | undefined
): Pick<
  CrmContactResponse,
  | 'email'
  | 'emails'
  | 'personalEmail'
  | 'companyId'
  | 'companyDomain'
  | 'companyDomainEmails'
> {
  const companyDomainEmails = companyId
    ? emails.filter((email) => email.endsWith('@example.com'))
    : [];
  return {
    email: emails[0] ?? null,
    emails,
    personalEmail: isPersonal(emails[0]),
    companyId: companyId ?? null,
    companyDomain: companyDomainEmails.length > 0,
    companyDomainEmails,
  };
}
let contacts: CrmContactResponse[] = ['Example person', 'Second person'].map(
  (name, index) => {
    const emails = params.has('empty')
      ? []
      : [
          `person${index + 1}@${domain}`,
          ...(params.has('several') && index === 0
            ? [`person1@${PERSONAL_DOMAIN}`, 'person1.alt@example.org'].filter(
                (email) => email !== `person1@${domain}`
              )
            : []),
        ];
    const full = identity(
      emails,
      params.has('empty') || params.has('unlinked') ? null : company.id
    );
    return {
      id: `contact-${index + 1}`,
      name,
      // `legacy` stands in for a server that predates the address list.
      ...(params.has('legacy')
        ? {
            email: full.email,
            companyId: full.companyId,
            personalEmail: full.personalEmail,
          }
        : full),
      hidden:
        params.has('legacyParent') && index === 0
          ? false
          : company.hidden || index === 1 || params.has('archived'),
      createdAt: '2026-10-15',
      updatedAt: '2026-10-15',
      firstInteraction: '2026-10-15',
      lastInteraction: '2026-10-15',
    };
  }
);
/** Apply a committed identity change to one contact and return its response. */
function commit(
  contactId: string,
  change: (contact: CrmContactResponse) => {
    emails: string[];
    companyId: string | null | undefined;
  }
) {
  contacts = contacts.map((contact) => {
    if (contact.id !== contactId) return contact;
    const next = change(contact);
    const full = identity(next.emails, next.companyId);
    return {
      ...contact,
      ...(params.has('legacy')
        ? {
            email: full.email,
            companyId: full.companyId,
            personalEmail: full.personalEmail,
          }
        : full),
      updatedAt: new Date().toISOString(),
    };
  });
  return ok({ ...contacts.find((contact) => contact.id === contactId)! });
}
const held = (contact: CrmContactResponse) =>
  contact.emails ?? (contact.email ? [contact.email] : []);
const takenByAnother = (contactId: string, email: string) =>
  contacts.some(
    (contact) => contact.id !== contactId && held(contact).includes(email)
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
  async getCompany({ companyId }) {
    const selected =
      companyId === 'company-2'
        ? { ...company, id: companyId, name: 'Second company' }
        : company;
    return ok({
      ...selected,
      contacts: contacts
        .filter((contact) => contact.companyId === companyId)
        .map((contact) => ({ ...contact })),
    });
  },
  async getContact({ contactId }) {
    return ok({ ...contacts.find((contact) => contact.id === contactId)! });
  },
  async setContactEmail({ contactId, email }) {
    const address = email.trim().toLowerCase();
    if (!(await save()) || takenByAnother(contactId, address))
      return err([{ code: 'CONFLICT', message: 'Save rejected' }]);
    return commit(contactId, (contact) => ({
      emails: [address, ...held(contact).filter((other) => other !== address)],
      companyId: contact.companyId,
    }));
  },
  async addContactEmail({ contactId, email }) {
    const address = email.trim().toLowerCase();
    // A server that predates the address list has no such route.
    if (params.has('legacy'))
      return err([{ code: 'NOT_FOUND', message: 'No route' }]);
    if (!(await save()) || takenByAnother(contactId, address))
      return err([{ code: 'CONFLICT', message: 'Save rejected' }]);
    return commit(contactId, (contact) => ({
      emails: [...held(contact).filter((other) => other !== address), address],
      companyId: contact.companyId,
    }));
  },
  async removeContactEmail({ contactId, email }) {
    const current = contacts.find((contact) => contact.id === contactId);
    if (!(await save()) || current?.companyDomainEmails?.join() === email)
      return err([{ code: 'BAD_REQUEST', message: 'Save rejected' }]);
    return commit(contactId, (contact) => ({
      emails: held(contact).filter((other) => other !== email),
      companyId: contact.companyId,
    }));
  },
  async setContactCompany({ contactId, companyId }) {
    if (!(await save()))
      return err([{ code: 'FORBIDDEN', message: 'Save rejected' }]);
    return commit(contactId, (contact) => ({
      emails: held(contact),
      companyId,
    }));
  },
  async unlinkContactCompany({ contactId }) {
    const current = contacts.find((contact) => contact.id === contactId);
    if (!(await save()) || current?.companyDomain)
      return err([{ code: 'BAD_REQUEST', message: 'Save rejected' }]);
    return commit(contactId, (contact) => ({
      emails: held(contact),
      companyId: null,
    }));
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
  | 'setContactEmail'
  | 'addContactEmail'
  | 'removeContactEmail'
  | 'setContactCompany'
  | 'unlinkContactCompany'
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
  editContactEmail: () => useSetContactEmailMutation(deps),
  editContactCompany: () => useSetContactCompanyMutation(deps),
  setEmailSync: () => useSetEmailSyncMutation(deps),
  createNavigation: () => ({
    openWithSplit(target: { id: string }) {
      location.search = `?kind=company&companyArchived&opened=${target.id}`;
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
    selectContact,
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
      selectContact(value: string): void;
      writes(): number;
      snapshot(): {
        company: CrmCompanyResponse;
        contacts: CrmContactResponse[];
      };
    };
  }
}
