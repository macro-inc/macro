import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCompanyContactsQuery } from './company-contacts';
import { editContact } from './contact-edit';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const mocks = vi.hoisted(() => ({
  current: true,
  commit: vi.fn(async () => undefined),
  invalidate: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
}));
vi.mock('@service-storage/crm-contact-edit', () => ({
  prepareCrmContactEdit: () => ({
    isCurrent: () => mocks.current,
    commit: mocks.commit,
    invalidate: mocks.invalidate,
  }),
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));
vi.mock('@macro-inc/observability', () => {
  const span = {
    setAttr() {},
    span: (_name: string, run: () => unknown) => run(),
    run: (run: () => unknown) => run(),
  };
  return {
    Telemetry: {
      span: (_name: string, run: (value: typeof span) => unknown) => run(span),
      error: vi.fn(),
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = true;
});
const before: CrmContactResponse = {
  id: 'contact-1',
  companyId: null,
  email: 'first@example.com',
  name: 'Example person',
  hidden: false,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};

it('authoritatively refreshes a successful save when editable fields changed during the request', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  const intermediate = {
    ...before,
    email: 'second@example.com',
    updatedAt: '2026-10-03',
  };
  // The final transaction started earlier but committed last; timestamps cannot order them.
  const committed = {
    ...before,
    email: 'third@example.com',
    updatedAt: '2026-10-02',
  };
  client.setQueryData(key, intermediate);
  const read = vi.fn(async () => committed);
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: read,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  const primary = vi.fn(async () => ok(committed));
  // Replica refresh still sees the previous address; primary must win last.
  mocks.refresh.mockImplementationOnce(async () => {
    client.setQueryData(key, intermediate);
  });
  const deps = {
    client,
    storage: { getContact: primary },
  } as unknown as CrmRecordDependencies;
  await editContact(deps, before, 'email', async () => ok(committed));
  expect(primary).toHaveBeenCalledExactlyOnceWith({ contactId: before.id });
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(committed, null);
  expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith(before.id);
  expect(mocks.refresh).toHaveBeenCalledWith(
    expect.objectContaining({ unmaintainedOnly: false })
  );
  expect(read).toHaveBeenCalledOnce();
  expect(client.getQueryData(key)).toEqual(committed);
  unsubscribe();
  client.clear();
});

it('refetches a searched Team list when a new primary address stops matching it', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const anna = {
    ...before,
    companyId: 'company-1',
    name: null,
    email: 'anna@example.com',
  };
  let stored: CrmContactResponse = anna;
  const listCompanyContactsPage = vi.fn(async ({ query }: { query?: string }) =>
    ok({
      contacts: !query || stored.email?.includes(query) ? [stored] : [],
      nextCursor: null,
    })
  );
  const deps = {
    client,
    storage: {
      listCompanyContactsPage,
      getCompany: async () => ok({ id: 'company-1', name: 'Example' }),
    },
  } as unknown as CrmRecordDependencies;
  const { source, dispose } = createRoot((dispose) => ({
    source: useCompanyContactsQuery(deps, () => ({
      companyId: 'company-1',
      archived: false,
      search: 'anna',
    })),
    dispose,
  }));
  await vi.waitFor(() => expect(source.contacts).toEqual([anna]));

  const edited = { ...anna, email: 'bo@example.com', updatedAt: '2026-10-02' };
  await editContact(deps, anna, 'email', async () => {
    stored = edited;
    return ok(edited);
  });
  expect(listCompanyContactsPage).toHaveBeenCalledTimes(2);
  expect(source.contacts).toEqual([]);
  dispose();
  client.clear();
});

it("names the company from the detail's summary without reading the company", async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  const detail = {
    ...before,
    companyId: 'company-1',
    company: {
      id: 'company-1',
      name: 'Example company',
      domain: 'example.com',
      hidden: false,
    },
  };
  client.setQueryData(key, detail);
  const saved = {
    ...before,
    companyId: 'company-1',
    email: 'second@example.com',
    updatedAt: '2026-10-02',
  };
  const getCompany = vi.fn(async () => ok({ name: 'Read company' }));
  const deps = {
    client,
    storage: { getCompany },
  } as unknown as CrmRecordDependencies;
  await editContact(deps, detail, 'email', async () => ok(saved));
  expect(getCompany).not.toHaveBeenCalled();
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(
    saved,
    'Example company'
  );
  client.clear();
});

it("names the company from the primary read's summary when recovering", async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  const company = {
    id: 'company-1',
    name: 'Example company',
    domain: 'example.com',
    hidden: false,
  };
  // A conflicting edit landed meanwhile, so the save recovers from a primary read.
  client.setQueryData(key, {
    ...before,
    email: 'second@example.com',
    updatedAt: '2026-10-03',
  });
  const committed = {
    ...before,
    companyId: 'company-1',
    email: 'third@example.com',
    updatedAt: '2026-10-02',
  };
  const getCompany = vi.fn(async () => ok({ name: 'Read company' }));
  const deps = {
    client,
    storage: {
      getContact: vi.fn(async () => ok({ ...committed, company })),
      getCompany,
    },
  } as unknown as CrmRecordDependencies;
  await editContact(deps, before, 'company', async () => ok(committed));
  expect(getCompany).not.toHaveBeenCalled();
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(
    { ...committed, company },
    'Example company'
  );
  client.clear();
});
