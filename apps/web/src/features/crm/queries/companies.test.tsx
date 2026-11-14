import { cleanup, render } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmRecordDependencies } from './dependencies';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: vi.fn(async () => undefined),
}));

import {
  useCreateCompanyMutation,
  useCreateContactMutation,
  useSetCompanyNameMutation,
} from './companies';
import { crmKeys } from './keys';

const storage = {
  createCompany: vi.fn(),
  createContact: vi.fn(),
  setCompanyName: vi.fn(),
};
let client: QueryClient;

beforeEach(() => {
  track.mockReset();
  storage.createCompany.mockReset();
  storage.createContact.mockReset();
  storage.setCompanyName.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  const deps = { storage, client } as unknown as CrmRecordDependencies;
  let mutations!: {
    company: ReturnType<typeof useCreateCompanyMutation>;
    contact: ReturnType<typeof useCreateContactMutation>;
    rename: ReturnType<typeof useSetCompanyNameMutation>;
  };
  function Probe() {
    mutations = {
      company: useCreateCompanyMutation(deps),
      contact: useCreateContactMutation(deps),
      rename: useSetCompanyNameMutation(deps),
    };
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  return mutations;
}

it('reports a created company and contact with their ids', async () => {
  storage.createCompany.mockResolvedValue(ok({ id: 'company-1' }));
  storage.createContact.mockResolvedValue(
    ok({ id: 'contact-1', companyId: 'company-1' })
  );
  const mutations = mount();

  await mutations.company.mutateAsync({ name: 'Acme', domain: 'acme.com' });
  await mutations.contact.mutateAsync({
    companyId: 'company-1',
    name: 'Ada',
    email: 'ada@acme.com',
  });

  expect(track.mock.calls).toEqual([
    ['crm_company_created', { companyId: 'company-1' }],
    ['crm_contact_created', { companyId: 'company-1', contactId: 'contact-1' }],
  ]);
});

it('reports nothing when creation fails', async () => {
  storage.createCompany.mockResolvedValue(err([{ message: 'Taken' }]));
  storage.createContact.mockResolvedValue(err([{ message: 'Taken' }]));
  const mutations = mount();

  await expect(
    mutations.company.mutateAsync({ name: 'Acme', domain: 'acme.com' })
  ).rejects.toBeDefined();
  await expect(
    mutations.contact.mutateAsync({
      companyId: 'company-1',
      name: 'Ada',
      email: 'ada@acme.com',
    })
  ).rejects.toBeDefined();

  expect(track).not.toHaveBeenCalled();
});

it("refreshes the details of the renamed company's contacts only", async () => {
  storage.setCompanyName.mockResolvedValue(ok({}));
  const own = crmKeys.contact('contact-1').queryKey;
  const other = crmKeys.contact('contact-2').queryKey;
  client.setQueryData(own, { id: 'contact-1', companyId: 'company-1' });
  client.setQueryData(other, { id: 'contact-2', companyId: 'company-2' });
  const mutations = mount();

  await mutations.rename.mutateAsync({ companyId: 'company-1', name: 'Acme' });

  expect(client.getQueryState(own)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it('reads a contact detail again when it was loading during a rename', async () => {
  storage.setCompanyName.mockResolvedValue(ok({}));
  const key = crmKeys.contact('contact-3').queryKey;
  const answers: Array<(value: unknown) => void> = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => new Promise((resolve) => answers.push(resolve)),
    staleTime: 60_000,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const mutations = mount();

  const rename = mutations.rename.mutateAsync({
    companyId: 'company-1',
    name: 'Acme',
  });
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  // The read started before the rename answers with the old name.
  answers[0]?.({ id: 'contact-3', company: { name: 'Old' } });
  answers[1]?.({ id: 'contact-3', company: { name: 'Acme' } });
  await rename;

  expect(client.getQueryData(key)).toEqual({
    id: 'contact-3',
    company: { name: 'Acme' },
  });
  unsubscribe();
});

const summary = (id: string, name: string) => ({
  id,
  name,
  domain: 'example.com',
  hidden: false,
});

it("renames the company in its contacts' details before the server answers", async () => {
  let answer!: (value: unknown) => void;
  storage.setCompanyName.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  const own = crmKeys.contact('contact-1').queryKey;
  const other = crmKeys.contact('contact-2').queryKey;
  client.setQueryData(own, {
    id: 'contact-1',
    companyId: 'company-1',
    company: summary('company-1', 'Old'),
  });
  client.setQueryData(other, {
    id: 'contact-2',
    companyId: 'company-2',
    company: summary('company-2', 'Other'),
  });
  const mutations = mount();

  const rename = mutations.rename.mutateAsync({
    companyId: 'company-1',
    name: 'New',
  });
  await vi.waitFor(() =>
    expect(client.getQueryData(own)).toMatchObject({
      company: { name: 'New' },
    })
  );
  expect(client.getQueryData(other)).toMatchObject({
    company: { name: 'Other' },
  });
  answer(ok({}));
  await rename;
});

it('restores the name and reads no detail again when a rename fails', async () => {
  storage.setCompanyName.mockResolvedValue(err([{ message: 'Refused' }]));
  const own = crmKeys.contact('contact-1').queryKey;
  client.setQueryData(own, {
    id: 'contact-1',
    companyId: 'company-1',
    company: summary('company-1', 'Old'),
  });
  const mutations = mount();

  await expect(
    mutations.rename.mutateAsync({ companyId: 'company-1', name: 'New' })
  ).rejects.toBeDefined();

  expect(client.getQueryData(own)).toMatchObject({
    company: { name: 'Old' },
  });
  expect(client.getQueryState(own)?.isInvalidated).toBe(false);
});
