import type { storageServiceClient as Storage } from '@service-storage/client';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const analytics = { track() {} };
export async function invalidateCachedCrmContacts() {}
export const useCrmContext = () => ({
  createNavigation: () => ({ openWithSplit() {} }),
  openCreateContact() {},
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
export const [role, setRole] = createSignal('admin');
export const [failNext, setFailNext] = createSignal(false);
export const [companyReads, setCompanyReads] = createSignal(0);
export const [writes, setWrites] = createSignal(0);

export const storageServiceClient = {
  async getCompany() {
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
      contacts: contacts.filter(
        (contact) =>
          contact.companyId === 'company-1' &&
          (role() !== 'member' || !contact.hidden)
      ),
    };
    return ok(company);
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
  'getCompany' | 'getContact' | 'setContactHidden'
>;
