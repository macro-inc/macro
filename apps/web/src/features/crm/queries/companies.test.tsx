import { cleanup, render } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmCreateDependencies } from './dependencies';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: vi.fn(async () => undefined),
}));
const refreshGraphqlLists = vi.hoisted(() => vi.fn(async () => undefined));
const creates = vi.hoisted(() => ({ company: vi.fn(), contact: vi.fn() }));
const edits = vi.hoisted(() => ({ rename: vi.fn(), domain: vi.fn() }));
vi.mock('@service-storage/graphql-crm-edits', () => ({
  renameGraphqlCrmCompany: edits.rename,
  editGraphqlCrmCompanyDomain: edits.domain,
}));
const cacheHost = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-crm-create', () => ({
  createGraphqlCrmCompany: creates.company,
  createGraphqlCrmContact: creates.contact,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: refreshGraphqlLists,
}));

import {
  createCompanyImporter,
  useCreateCompanyMutation,
  useCreateContactMutation,
  useEditCompanyDomainMutation,
  useSetCompanyNameMutation,
  useSetEmailSyncMutation,
} from './companies';
import { crmKeys } from './keys';

const storage = {
  setEmailSync: vi.fn(),
};
let client: QueryClient;

beforeEach(() => {
  track.mockReset();
  refreshGraphqlLists.mockClear();
  creates.company.mockReset();
  creates.contact.mockReset();
  cacheHost.mockReset();
  edits.rename.mockReset();
  edits.domain.mockReset();
  storage.setEmailSync.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  const deps = {
    storage,
    client,
    hasLiveCache: () => Boolean(cacheHost()),
  } as unknown as CrmCreateDependencies;
  let mutations!: {
    company: ReturnType<typeof useCreateCompanyMutation>;
    contact: ReturnType<typeof useCreateContactMutation>;
    rename: ReturnType<typeof useSetCompanyNameMutation>;
    domain: ReturnType<typeof useEditCompanyDomainMutation>;
    emailSync: ReturnType<typeof useSetEmailSyncMutation>;
  };
  function Probe() {
    mutations = {
      company: useCreateCompanyMutation(deps),
      contact: useCreateContactMutation(deps),
      rename: useSetCompanyNameMutation(deps),
      domain: useEditCompanyDomainMutation(deps),
      emailSync: useSetEmailSyncMutation(deps),
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

const confirmed = (id: string) => ({
  id,
  queued: false,
  effectsResolved: true,
  listsReadAgain: false,
  cacheRevalidates: false,
});

it('reports a created company and contact with their ids', async () => {
  creates.company.mockResolvedValue(confirmed('company-1'));
  creates.contact.mockResolvedValue(confirmed('contact-1'));
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

it('reads GraphQL lists that can show companies again after a create', async () => {
  creates.company.mockResolvedValue(confirmed('company-1'));
  cacheHost.mockReturnValue({});
  const mutations = mount();

  await mutations.company.mutateAsync({ name: 'Acme' });

  const where = refreshedLists(true);
  expect(where({ ccf: { l: { id: 'other' } } })).toBe(true);
  expect(
    where({ ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } } })
  ).toBe(false);
});

it.each([
  { listsReadAgain: true },
  { cacheRevalidates: true },
  { queued: true, id: undefined },
])(
  'does not duplicate list reads when the create returns %o',
  async (state) => {
    creates.company.mockResolvedValue({ ...confirmed('company-1'), ...state });
    const mutations = mount();
    await mutations.company.mutateAsync({ name: 'Acme' });
    expect(refreshGraphqlLists).not.toHaveBeenCalled();
  }
);

const EXCLUDED = { l: { id: '00000000-0000-0000-0000-000000000000' } };
const NO_CRM = { ccf: EXCLUDED };
const COMPANIES = { ccf: { l: { id: 'other' } } };
const CONTACTS = { ccf: EXCLUDED, crmf: { l: { id: 'other' } } };

/** The predicate of the one GraphQL list refresh the write started. */
function refreshedLists(unmaintainedOnly?: boolean) {
  expect(refreshGraphqlLists).toHaveBeenCalledOnce();
  const [options] = refreshGraphqlLists.mock.calls[0] as unknown as [
    { where: (body: unknown) => boolean; unmaintainedOnly?: boolean },
  ];
  expect(options.unmaintainedOnly).toBe(unmaintainedOnly);
  return options.where;
}

it('reads GraphQL lists that can show contacts again after a contact create', async () => {
  creates.contact.mockResolvedValue(confirmed('contact-1'));
  const mutations = mount();

  await mutations.contact.mutateAsync({ companyId: 'company-1', name: 'Ada' });

  const where = refreshedLists(false);
  expect(where(CONTACTS)).toBe(true);
  expect(where(COMPANIES)).toBe(false);
  expect(where(NO_CRM)).toBe(false);
});

it('limits the live-cache fallback even when the create returned no usable effects', async () => {
  creates.company.mockResolvedValue({
    ...confirmed('company-1'),
    effectsResolved: false,
  });
  cacheHost.mockReturnValue({});
  const mutations = mount();

  await mutations.company.mutateAsync({ name: 'Acme' });

  expect(refreshedLists(true)(COMPANIES)).toBe(true);
});

it('refreshes company lists once after a batch of GraphQL creates', async () => {
  creates.company.mockResolvedValue(confirmed('company-1'));
  const importer = createCompanyImporter({
    client,
    storage,
    hasLiveCache: () => false,
  } as unknown as CrmCreateDependencies);
  const inputs = [
    { name: 'First company', domain: 'first.example' },
    { name: 'Second company', domain: 'second.example' },
  ];

  await Promise.all(inputs.map((input) => importer.create(input)));
  expect(creates.company.mock.calls).toEqual(
    inputs.map((input) => [input, 'batch'])
  );
  expect(refreshGraphqlLists).not.toHaveBeenCalled();
  await importer.refresh();
  expect(refreshedLists(false)(COMPANIES)).toBe(true);
});

it('reads GraphQL lists that can show the company again after a rename', async () => {
  edits.rename.mockResolvedValue(confirmed('company-1'));
  const mutations = mount();

  await mutations.rename.mutateAsync({ companyId: 'company-1', name: 'Acme' });

  const where = refreshedLists(false);
  expect(where(COMPANIES)).toBe(true);
  expect(where(CONTACTS)).toBe(true);
  expect(where(NO_CRM)).toBe(false);
});

it('skips a duplicate company list read after the network exchange revalidates', async () => {
  edits.rename.mockResolvedValue({
    ...confirmed('company-1'),
    listsReadAgain: true,
  });
  await mount().rename.mutateAsync({ companyId: 'company-1', name: 'Acme' });
  expect(refreshGraphqlLists).not.toHaveBeenCalled();
});

it.each(['add', 'remove'] as const)(
  'reads GraphQL lists that can show the company again after a domain %s',
  async (change) => {
    const key = crmKeys.company('company-1').queryKey;
    client.setQueryData(key, { id: 'company-1', name: 'Acme', domains: [] });
    edits.domain.mockResolvedValue({
      ...confirmed('company-1'),
      payload: { companyId: 'company-1', domains: [{ domain: 'acme.com' }] },
    });
    cacheHost.mockReturnValue({});
    const mutations = mount();

    await mutations.domain.mutateAsync({
      companyId: 'company-1',
      domain: 'acme.io',
      change,
    });

    const where = refreshedLists(true);
    expect(where(COMPANIES)).toBe(true);
    expect(where(NO_CRM)).toBe(false);
    expect(client.getQueryData(key)).toEqual({
      id: 'company-1',
      name: 'Acme',
      domains: [{ companyId: 'company-1', domain: 'acme.com' }],
    });
  }
);

it('reads the company and CRM email lists again after an email sync change', async () => {
  storage.setEmailSync.mockResolvedValue(ok({}));
  client.setQueryData(crmKeys.company('company-1').queryKey, {
    id: 'company-1',
    domains: [{ domain: 'acme.com' }],
  });
  const mutations = mount();

  await mutations.emailSync.mutateAsync({
    companyId: 'company-1',
    emailSync: false,
  });

  const where = refreshedLists();
  expect(where(COMPANIES)).toBe(true);
  expect(where({ ...NO_CRM, ecd: ['acme.com'] })).toBe(true);
  expect(where({ ...NO_CRM, ef: { ed: ['acme.com'] } })).toBe(true);
  // A contact's email list and CRM activity show the company's mail too.
  expect(where({ ...NO_CRM, eca: ['person@example.com'] })).toBe(true);
  expect(where({ ...NO_CRM, crma: 'activity' })).toBe(true);
  expect(where({ ...NO_CRM, ef: { ed: ['other.com'] } })).toBe(false);
  expect(where(NO_CRM)).toBe(false);
});

it('reports nothing when creation fails', async () => {
  creates.company.mockRejectedValue(new Error('Taken'));
  creates.contact.mockRejectedValue(new Error('Taken'));
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
  edits.rename.mockResolvedValue(confirmed('company-1'));
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
  edits.rename.mockResolvedValue(confirmed('company-1'));
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
  edits.rename.mockReturnValue(
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
  answer(confirmed('company-1'));
  await rename;
});

it('restores the name and reads no detail again when a rename fails', async () => {
  edits.rename.mockRejectedValue(new Error('Refused'));
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
