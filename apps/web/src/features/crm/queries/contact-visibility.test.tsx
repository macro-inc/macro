import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { storageServiceClient } from '@service-storage/client';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';

const cache = vi.hoisted(() => ({
  commit: vi.fn(async () => {}),
  isCurrent: vi.fn(() => true),
}));
vi.mock('@service-storage/crm-visibility', () => ({
  prepareCrmVisibilityWrite: () => cache,
}));

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
  cache.isCurrent.mockReturnValue(true);
  cache.commit.mockResolvedValue(undefined);
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

it('keeps a successful backend write successful when a refresh fails', async () => {
  cache.commit.mockRejectedValueOnce(new Error('Cache unavailable'));
  const { mutation } = mount();
  await expect(
    mutation.mutateAsync({ contactId: CONTACT.id, hidden: true })
  ).resolves.toBeUndefined();
  expect(contact.hidden).toBe(true);
});

it('awaits GraphQL People membership refresh for hide and restore, excluding unrelated lists', async () => {
  let visible = [CONTACT.id];
  let removed: string[] = [];
  const visibleReader = vi.fn(async () => {
    visible = contact.hidden ? [] : [contact.id];
  });
  const removedReader = vi.fn(async () => {
    removed = contact.hidden ? [contact.id] : [];
  });
  const unrelated = vi.fn(async () => {});
  const unregister = [
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      body: () => ({ crmf: { l: { hidden: false } } }),
      refresh: visibleReader,
    }),
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      body: () => ({ crmf: { l: { hidden: true } } }),
      refresh: removedReader,
    }),
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      body: () => ({ df: {} }),
      refresh: unrelated,
    }),
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      body: () => ({
        crmf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
      }),
      refresh: unrelated,
    }),
  ];
  try {
    const { mutation } = mount();
    await mutation.mutateAsync({ contactId: CONTACT.id, hidden: true });
    expect(visible).toEqual([]);
    expect(removed).toEqual([CONTACT.id]);
    await mutation.mutateAsync({ contactId: CONTACT.id, hidden: false });
    expect(visible).toEqual([CONTACT.id]);
    expect(removed).toEqual([]);
    expect(visibleReader).toHaveBeenCalledTimes(2);
    expect(removedReader).toHaveBeenCalledTimes(2);
    expect(unrelated).not.toHaveBeenCalled();
  } finally {
    unregister.forEach((dispose) => dispose());
  }
});

it('preserves confirmed state after an active GraphQL refresh failure and skips refresh after a rejected write', async () => {
  const refresh = vi.fn(async () => {
    throw new Error('Unavailable');
  });
  const unregister = registerActiveGraphqlSoupQuery({
    isEnabled: () => true,
    body: () => ({ crmf: { l: { hidden: true } } }),
    refresh,
  });
  try {
    const { mutation } = mount();
    await expect(
      mutation.mutateAsync({ contactId: CONTACT.id, hidden: true })
    ).resolves.toBeUndefined();
    expect(
      client.getQueryData<CrmContactResponse>(
        crmKeys.contact(CONTACT.id).queryKey
      )?.hidden
    ).toBe(true);
    vi.mocked(storageServiceClient.setContactHidden).mockResolvedValue(
      err([{ code: 'FORBIDDEN', message: 'Denied' }])
    );
    await expect(
      mutation.mutateAsync({ contactId: CONTACT.id, hidden: false })
    ).rejects.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    unregister();
  }
});

it('ignores a late response after the session changes', async () => {
  const key = crmKeys.contact(CONTACT.id).queryKey;
  client.setQueryData(key, CONTACT);
  vi.mocked(storageServiceClient.setContactHidden).mockImplementation(
    async () => {
      cache.isCurrent.mockReturnValue(false);
      return ok(undefined);
    }
  );
  const { mutation } = mount();
  await mutation.mutateAsync({ contactId: CONTACT.id, hidden: true });
  expect(cache.commit).not.toHaveBeenCalled();
  expect(client.getQueryData<CrmContactResponse>(key)?.hidden).toBe(false);
});

it('keeps confirmed detail usable when background reads are unavailable', async () => {
  const { mutation, detail } = mount();
  await detail.refetch();
  vi.mocked(storageServiceClient.getContact).mockResolvedValue(
    err([{ code: 'NETWORK_ERROR', message: 'Offline' }])
  );
  const reads = vi.mocked(storageServiceClient.getContact).mock.calls.length;
  await mutation.mutateAsync({ contactId: CONTACT.id, hidden: true });
  expect(detail.isSuccess).toBe(true);
  expect(detail.data?.hidden).toBe(true);
  expect(storageServiceClient.getContact).toHaveBeenCalledTimes(reads);
});

it('restarts an active initial detail read cancelled by a successful row action', async () => {
  let release!: (
    value: Awaited<ReturnType<typeof storageServiceClient.getContact>>
  ) => void;
  vi.mocked(storageServiceClient.getContact).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const { mutation, detail } = mount();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await mutation.mutateAsync({ contactId: CONTACT.id, hidden: true });
  release(ok(CONTACT));
  await vi.waitFor(() => expect(detail.isSuccess).toBe(true));
  expect(detail.data?.hidden).toBe(true);
});
