import type { storageServiceClient as Storage } from '@service-storage/client';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';

export const analytics = { track() {} };
export async function invalidateCachedCrmContacts() {}
export const [role, setRole] = createSignal('admin');
export const [userId, setUserId] = createSignal('user-1');
export const [teamId, setTeamId] = createSignal('team-1');
export const [failNext, setFailNext] = createSignal(false);
export const [failRead, setFailRead] = createSignal(false);
export const [writes, setWrites] = createSignal(0);
const base: CrmContactResponse = {
  id: 'active',
  companyId: 'company-1',
  name: 'Active person',
  email: 'active@example.com',
  hidden: false,
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  firstInteraction: '2026-10-15',
  lastInteraction: '2026-10-15',
};
export let contacts = [
  { ...base, teamId: 'team-1', parentHidden: false },
  {
    ...base,
    id: 'unfiled',
    name: 'Unfiled person',
    email: 'unfiled@example.com',
    companyId: null,
    teamId: 'team-1',
    parentHidden: false,
  },
  {
    ...base,
    id: 'removed-a',
    email: 'removed-a@example.com',
    name: 'Removed first',
    hidden: true,
    teamId: 'team-1',
    parentHidden: false,
  },
  {
    ...base,
    id: 'removed-b',
    email: 'removed-b@example.com',
    name: 'Removed second',
    hidden: true,
    teamId: 'team-1',
    parentHidden: false,
  },
  {
    ...base,
    id: 'removed-c',
    name: 'Removed paged',
    email: 'paged@example.com',
    hidden: true,
    teamId: 'team-1',
    parentHidden: false,
  },
  {
    ...base,
    id: 'parent-hidden',
    email: 'parent@example.com',
    name: 'Hidden company person',
    companyId: 'hidden-company',
    teamId: 'team-1',
    parentHidden: true,
  },
  {
    ...base,
    id: 'other-team',
    email: 'other@example.com',
    name: 'Other team removed',
    hidden: true,
    teamId: 'team-2',
    parentHidden: false,
  },
];
export const storageServiceClient = {
  async getContact({ contactId }) {
    const contact = contacts.find(
      (item) => item.id === contactId && item.teamId === teamId()
    );
    if (
      !contact ||
      (role() === 'member' && (contact.hidden || contact.parentHidden))
    )
      return err([{ code: 'NOT_FOUND', message: 'Not found' }]);
    return ok({ ...contact });
  },
  async setContactHidden({ contactId, hidden }) {
    if (
      role() === 'member' ||
      failNext() ||
      !contacts.some(
        (item) => item.id === contactId && item.teamId === teamId()
      )
    ) {
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
} satisfies Pick<typeof Storage, 'getContact' | 'setContactHidden'>;

export const prepareCrmVisibilityWrite = () => ({
  isCurrent: () => true,
  async commit() {},
});
