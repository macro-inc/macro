import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmRecordDependencies } from './dependencies';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

import {
  useCreateCompanyMutation,
  useCreateContactMutation,
} from './companies';

const storage = { createCompany: vi.fn(), createContact: vi.fn() };
let client: QueryClient;

beforeEach(() => {
  track.mockReset();
  storage.createCompany.mockReset();
  storage.createContact.mockReset();
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
  };
  function Probe() {
    mutations = {
      company: useCreateCompanyMutation(deps),
      contact: useCreateContactMutation(deps),
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
