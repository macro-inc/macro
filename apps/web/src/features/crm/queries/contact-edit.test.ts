import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
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
