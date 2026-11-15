import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContactQuery, useCrmContactByEmailQuery } from './contacts';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

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
