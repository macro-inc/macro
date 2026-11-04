import { storageServiceClient } from '@service-storage/client';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContactQuery, useSetContactHiddenMutation } from './contacts';
import { crmKeys } from './keys';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { setContactHidden: vi.fn(), getContact: vi.fn() },
}));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: vi.fn(async () => {}),
}));

const CONTACT: CrmContactResponse = {
  id: 'contact-1',
  companyId: 'company-1',
  name: 'Example person',
  email: 'person@example.com',
  hidden: false,
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  firstInteraction: '2026-10-15',
  lastInteraction: '2026-10-15',
};
let client: QueryClient;
let contact: CrmContactResponse;

beforeEach(() => {
  vi.clearAllMocks();
  contact = { ...CONTACT };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(storageServiceClient.setContactHidden).mockImplementation(
    async ({ hidden }) => {
      contact = { ...contact, hidden };
      return ok(undefined);
    }
  );
  vi.mocked(storageServiceClient.getContact).mockImplementation(async () =>
    ok({ ...contact })
  );
  vi.mocked(invalidateCachedCrmContacts).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  let mutation!: ReturnType<typeof useSetContactHiddenMutation>;
  let detail!: ReturnType<typeof useContactQuery>;
  render(() => {
    const deps = { client, storage: storageServiceClient };
    mutation = useSetContactHiddenMutation(deps);
    detail = useContactQuery(deps, () => CONTACT.id);
    return null;
  });
  return { mutation, detail };
}

it('refreshes active company lists on hide and restore while preserving admin detail access', async () => {
  const company = new QueryObserver(client, {
    queryKey: crmKeys.company('company-1').queryKey,
    queryFn: async () => ({ contacts: [{ ...contact }] }),
    staleTime: Infinity,
  });
  const unsubscribe = company.subscribe(() => {});
  await company.refetch();
  const { mutation } = mount();
  for (const hidden of [true, false]) {
    await mutation.mutateAsync({ contactId: CONTACT.id, hidden });
    expect(company.getCurrentResult().data?.contacts).toEqual([
      { ...CONTACT, hidden },
    ]);
    expect(client.getQueryData(crmKeys.contact(CONTACT.id).queryKey)).toEqual({
      ...CONTACT,
      hidden,
    });
  }
  unsubscribe();
});

it('invalidates an inactive company so returning to Team reloads its contacts', async () => {
  const options = {
    queryKey: crmKeys.company('company-1').queryKey,
    queryFn: async () => ({ contacts: [{ ...contact }] }),
    staleTime: Infinity,
  };
  await client.fetchQuery(options);
  const { mutation } = mount();
  await mutation.mutateAsync({ contactId: CONTACT.id, hidden: true });
  expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
  expect((await client.fetchQuery(options)).contacts).toEqual([
    { ...CONTACT, hidden: true },
  ]);
});

it('hides and restores contacts without a company or an invented company query', async () => {
  contact = { ...CONTACT, companyId: null };
  const { mutation } = mount();
  for (const hidden of [true, false]) {
    await mutation.mutateAsync({ contactId: CONTACT.id, hidden });
    expect(client.getQueryData(crmKeys.contact(CONTACT.id).queryKey)).toEqual({
      ...CONTACT,
      companyId: null,
      hidden,
    });
    expect(
      client.getQueryCache().findAll({ queryKey: crmKeys.company._def })
    ).toHaveLength(0);
  }
});

it('leaves cached lists unchanged and surfaces a rejected visibility write', async () => {
  vi.mocked(storageServiceClient.setContactHidden).mockResolvedValue(
    err([{ code: 'FORBIDDEN', message: 'Denied' }])
  );
  const key = crmKeys.company('company-1').queryKey;
  const cached = { contacts: [CONTACT] };
  client.setQueryData(key, cached);
  const { mutation } = mount();
  await expect(
    mutation.mutateAsync({ contactId: CONTACT.id, hidden: true })
  ).rejects.toThrow();
  expect(client.getQueryData(key)).toEqual(cached);
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(invalidateCachedCrmContacts).not.toHaveBeenCalled();
});

it('preserves a member denial when loading a hidden contact directly', async () => {
  vi.mocked(storageServiceClient.getContact).mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not found' }])
  );
  const { detail } = mount();
  await detail.refetch();
  expect(
    client.getQueryState(crmKeys.contact(CONTACT.id).queryKey)?.status
  ).toBe('error');
  expect(
    client.getQueryData(crmKeys.contact(CONTACT.id).queryKey)
  ).toBeUndefined();
});

it('surfaces a cache refresh failure after a successful write', async () => {
  vi.mocked(invalidateCachedCrmContacts).mockRejectedValueOnce(
    new Error('Cache unavailable')
  );
  const { mutation } = mount();
  await expect(
    mutation.mutateAsync({ contactId: CONTACT.id, hidden: true })
  ).rejects.toThrow('Cache unavailable');
  expect(contact.hidden).toBe(true);
});
