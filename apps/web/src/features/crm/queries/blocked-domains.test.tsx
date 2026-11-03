import { storageServiceClient } from '@service-storage/client';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBlockedDomains } from './blocked-domains';
import { crmKeys } from './keys';

const state = vi.hoisted(() => ({
  blocked: false,
  records: new Set<string>(),
  block: vi.fn(),
  unblock: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    listCrmBlockedDomains: async () =>
      ok(state.blocked ? [{ domain: 'example.com' }] : []),
    blockCrmDomain: state.block,
    unblockCrmDomain: state.unblock,
  },
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({
    search: async ({ buckets }: { buckets: string[] }) => ({
      documents: [...state.records]
        .filter((recordKey) =>
          buckets.some((bucket) =>
            recordKey.startsWith(
              bucket === 'crm_company'
                ? 'GraphqlSoupCrmCompany:'
                : 'GraphqlSoupCrmContact:'
            )
          )
        )
        .map((recordKey) => ({ recordKey })),
      nextCursor: null,
    }),
    deleteRecords: async (keys: string[]) => {
      for (const key of keys) state.records.delete(key);
    },
  }),
  getGraphqlSoupClient: () => ({
    query: () => ({
      toPromise: async () => ({
        data: {
          user: {
            soup: {
              items: state.blocked
                ? []
                : [{ __typename: 'GraphqlSoupCrmContact', id: 'contact-1' }],
              nextCursor: null,
            },
          },
        },
      }),
    }),
  }),
}));

let client: QueryClient;

beforeEach(() => {
  state.blocked = false;
  state.records.clear();
  state.records.add('GraphqlSoupCrmContact:contact-1');
  state.records.add('GraphqlSoupCrmCompany:company-1');
  state.block.mockReset().mockImplementation(async () => {
    state.blocked = true;
    return ok(undefined);
  });
  state.unblock.mockReset().mockImplementation(async () => {
    state.blocked = false;
    return ok(undefined);
  });
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  let source!: ReturnType<typeof useBlockedDomains>;
  render(() => {
    source = useBlockedDomains({
      storage: storageServiceClient,
      client,
      feedback: { success: () => {}, failure: () => {} },
    });
    return null;
  });
  return source;
}

it.each([true, false])(
  'evicts cached contacts and companies and reloads server visibility when blocked=%s',
  async (blocked) => {
    state.blocked = !blocked;
    const source = mount();

    await source.setBlocked.mutateAsync({ domain: 'example.com', blocked });

    expect(state.records.size).toBe(0);
    expect(client.getQueryData(crmKeys.blockedDomains.queryKey)).toEqual(
      blocked ? [{ domain: 'example.com' }] : []
    );
    const page = await fetchCrmContacts({ limit: 20 });
    expect(page.contacts.map((contact) => contact.id)).toEqual(
      blocked ? [] : ['contact-1']
    );
  }
);

it('keeps cached contacts when the server rejects the block', async () => {
  state.block.mockResolvedValueOnce(err([{ message: 'Denied' }]));
  const source = mount();

  await expect(
    source.setBlocked.mutateAsync({ domain: 'example.com', blocked: true })
  ).rejects.toBeDefined();

  expect([...state.records]).toEqual([
    'GraphqlSoupCrmContact:contact-1',
    'GraphqlSoupCrmCompany:company-1',
  ]);
  expect(state.blocked).toBe(false);
});
