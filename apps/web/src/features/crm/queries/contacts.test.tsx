import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContactQuery } from './contacts';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const storage = { getContact: vi.fn(), getContactByEmail: vi.fn() };
const ada = {
  id: '0b7f6a52-1f43-4c3e-9a0e-5d2f1c6b8e01',
  email: 'ada@example.com',
};
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

function mount(contactId: string) {
  const deps = { storage, client } as unknown as CrmRecordDependencies;
  let query!: ReturnType<typeof useContactQuery>;
  function Probe() {
    query = useContactQuery(deps, () => contactId);
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  return query;
}

it('resolves a legacy email id to the CRM contact with that email', async () => {
  storage.getContactByEmail.mockResolvedValue(ok({ contact: ada }));
  const query = mount('Ada%40example.com');

  await waitFor(() => expect(query.data).toEqual(ada));
  expect(storage.getContactByEmail).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'ada@example.com' })
  );
  expect(storage.getContact).not.toHaveBeenCalled();
  expect(client.getQueryData(crmKeys.contact(ada.id).queryKey)).toEqual(ada);
});

it('keeps a literal percent in an already decoded legacy email id', async () => {
  storage.getContactByEmail.mockResolvedValue(ok({ contact: ada }));
  const query = mount('ada%20tag@example.com');

  await waitFor(() => expect(query.data).toEqual(ada));
  expect(storage.getContactByEmail).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'ada%20tag@example.com' })
  );
});

it('fails a legacy email id that no CRM contact has', async () => {
  storage.getContactByEmail.mockResolvedValue(ok({ contact: null }));
  const query = mount('nobody@example.com');

  await waitFor(() => expect(query.isError).toBe(true));
});

it('fetches a CRM contact id directly', async () => {
  storage.getContact.mockResolvedValue(ok(ada));
  const query = mount(ada.id);

  await waitFor(() => expect(query.data).toEqual(ada));
  expect(storage.getContactByEmail).not.toHaveBeenCalled();
});
