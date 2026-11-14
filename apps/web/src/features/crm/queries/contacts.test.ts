import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useCompanyContactsQuery } from './company-contacts';
import { useSetContactNameMutation } from './contacts';
import type { CrmRecordDependencies } from './dependencies';

vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: async () => undefined,
}));

const anna: CrmContactResponse = {
  id: 'contact-1',
  companyId: 'company-1',
  email: 'person@example.com',
  name: 'Anna',
  hidden: false,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};

it('refetches a searched Team list when a rename stops matching it', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let stored = anna;
  const listCompanyContactsPage = vi.fn(async ({ query }: { query?: string }) =>
    ok({
      contacts:
        !query || stored.name?.toLowerCase().includes(query) ? [stored] : [],
      nextCursor: null,
    })
  );
  const setContactName = vi.fn(async ({ name }: { name: string }) => {
    stored = { ...stored, name, updatedAt: '2026-10-02' };
    return ok(stored);
  });
  const deps = {
    client,
    storage: { listCompanyContactsPage, setContactName },
  } as unknown as CrmRecordDependencies;
  const { source, rename, dispose } = createRoot((dispose) => ({
    source: useCompanyContactsQuery(deps, () => ({
      companyId: 'company-1',
      archived: false,
      search: 'anna',
    })),
    rename: useSetContactNameMutation(deps),
    dispose,
  }));
  await vi.waitFor(() => expect(source.contacts).toEqual([anna]));

  await rename.mutateAsync({
    contactId: anna.id,
    companyId: anna.companyId,
    name: 'Bo',
  });
  expect(listCompanyContactsPage).toHaveBeenCalledTimes(2);
  expect(source.contacts).toEqual([]);
  dispose();
  client.clear();
});
