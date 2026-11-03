import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { storageServiceClient } from '@service-storage/client';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
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
        .filter((key) =>
          buckets.includes(
            key.startsWith('GraphqlSoupCrmCompany:')
              ? 'crm_company'
              : 'crm_contact'
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
  'evicts cached companies and contacts before refreshing GraphQL lists when blocked=%s',
  async (blocked) => {
    state.blocked = !blocked;
    const source = mount();
    let companyHidden = !blocked;
    const refresh = vi.fn(async () => {
      expect(state.records.size).toBe(0);
      companyHidden = state.blocked;
    });
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        cacheMaintained: () => true,
        body: () => ({ ccf: { l: { hidden: false } } }),
        refresh,
      })
    );
    const unrelatedRefresh = vi.fn(async () => {});
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        body: () => ({
          ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
          crmf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
        }),
        refresh: unrelatedRefresh,
      })
    );

    await source.setBlocked.mutateAsync({ domain: 'example.com', blocked });

    expect(state.records.size).toBe(0);
    expect(companyHidden).toBe(blocked);
    expect(refresh).toHaveBeenCalledOnce();
    expect(unrelatedRefresh).not.toHaveBeenCalled();
    expect(client.getQueryData(crmKeys.blockedDomains.queryKey)).toEqual(
      blocked ? [{ domain: 'example.com' }] : []
    );
    const page = await fetchCrmContacts({ limit: 20 });
    expect(page.contacts.map((contact) => contact.id)).toEqual(
      blocked ? [] : ['contact-1']
    );
  }
);

it.each([
  {
    body: { ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } } },
    refreshes: 0,
  },
  {
    body: {
      ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
      crmf: null,
    },
    refreshes: 0,
  },
  {
    body: {
      ccf: {
        '&': [
          { l: { hidden: false } },
          { l: { id: '00000000-0000-0000-0000-000000000000' } },
        ],
      },
    },
    refreshes: 0,
  },
  {
    body: {
      ccf: {
        '|': [
          { l: { hidden: false } },
          { l: { id: '00000000-0000-0000-0000-000000000000' } },
        ],
      },
    },
    refreshes: 1,
  },
  {
    body: {
      ccf: { '!': { l: { id: '00000000-0000-0000-0000-000000000000' } } },
    },
    refreshes: 1,
  },
  {
    body: {
      ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
      crmf: { l: { hidden: false } },
    },
    refreshes: 1,
  },
  { body: undefined, refreshes: 0 },
])(
  'scopes mounted-list refreshes to CRM readers: $body',
  async ({ body, refreshes }) => {
    const refresh = vi.fn(async () => {});
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        cacheMaintained: () => true,
        body: () => body,
        refresh,
      })
    );
    const source = mount();

    await source.setBlocked.mutateAsync({
      domain: 'example.com',
      blocked: true,
    });

    expect(refresh).toHaveBeenCalledTimes(refreshes);
  }
);

it('keeps cached CRM records when the server rejects the block', async () => {
  state.block.mockResolvedValueOnce(err([{ message: 'Denied' }]));
  const refresh = vi.fn(async () => {});
  onTestFinished(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      body: () => ({}),
      refresh,
    })
  );
  const source = mount();

  await expect(
    source.setBlocked.mutateAsync({ domain: 'example.com', blocked: true })
  ).rejects.toBeDefined();

  expect([...state.records]).toEqual([
    'GraphqlSoupCrmContact:contact-1',
    'GraphqlSoupCrmCompany:company-1',
  ]);
  expect(state.blocked).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});
