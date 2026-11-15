import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCompanyContactsQuery } from './company-contacts';
import {
  useContactQuery,
  useCrmContactByEmailQuery,
  useSetContactNameMutation,
} from './contacts';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: async () => undefined,
}));

const storage = { getContact: vi.fn(), getContactByEmail: vi.fn() };
let client: QueryClient;

beforeEach(() => {
  storage.getContact.mockReset();
  storage.getContactByEmail.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

const company = {
  id: 'company-1',
  name: 'Example company',
  domain: 'example.com',
  hidden: false,
};
const contact = {
  id: 'contact-1',
  companyId: 'company-1',
  email: 'person@example.com',
  name: 'Example person',
  hidden: false,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-02',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};

function mountByEmail() {
  const deps = { storage, client } as unknown as CrmRecordDependencies;
  function Probe() {
    useCrmContactByEmailQuery(
      deps,
      () => 'team-1',
      () => contact.email,
      () => true
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
}

it("primes a contact's detail and keeps its company summary", async () => {
  const key = crmKeys.contact(contact.id).queryKey;
  client.setQueryData(key, { ...contact, name: 'Old name', company });
  storage.getContactByEmail.mockResolvedValue(ok({ contact }));

  mountByEmail();

  await vi.waitFor(() =>
    expect(client.getQueryData(key)).toEqual({ ...contact, company })
  );
});

it('drops the summary of a company the contact left', async () => {
  const key = crmKeys.contact(contact.id).queryKey;
  client.setQueryData(key, { ...contact, company });
  const moved = { ...contact, companyId: 'company-2' };
  storage.getContactByEmail.mockResolvedValue(ok({ contact: moved }));

  mountByEmail();

  await vi.waitFor(() => expect(client.getQueryData(key)).toEqual(moved));
});

it('reads a contact detail with an abortable request', async () => {
  storage.getContact.mockResolvedValue(ok({ ...contact, company }));
  const deps = { storage, client } as unknown as CrmRecordDependencies;
  function Probe() {
    useContactQuery(deps, () => contact.id);
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));

  await vi.waitFor(() => expect(storage.getContact).toHaveBeenCalledOnce());
  expect(storage.getContact.mock.calls[0]?.[0]).toEqual({
    contactId: contact.id,
    signal: expect.any(AbortSignal),
  });
});

it('refetches a searched Team list when a rename stops matching it', async () => {
  // The search matches the name only, never the address.
  const anna = { ...contact, name: 'Anna' };
  let stored = anna;
  const listCompanyContactsPage = vi.fn(async ({ query }: { query?: string }) =>
    ok({
      contacts:
        !query || stored.name?.toLowerCase().includes(query) ? [stored] : [],
      nextCursor: null,
    })
  );
  const setContactName = vi.fn(async ({ name }: { name: string }) => {
    stored = { ...stored, name, updatedAt: '2026-10-03' };
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
});
