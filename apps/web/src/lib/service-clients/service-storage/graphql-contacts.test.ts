import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  ContactReferencePageDocument,
  type ContactReferencePageQueryVariables,
} from './graphql/generated/graphql';
import {
  fetchContactReferencePage,
  hydrateGraphqlContacts,
} from './graphql-contacts';

const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
  graphqlSoupTransportDocument: (query: string) =>
    query.replaceAll('@cacheOnly', ''),
}));
const scope = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const data = {
  user: {
    id: scope.identity,
    contacts: {
      nodes: [
        {
          id: 'contact-id',
          userId: 'macro|person@example.com',
          email: 'person@example.com',
          name: 'Person',
        },
      ],
      nextCursor: 'next',
    },
  },
};
const cached = {
  kind: 'data' as const,
  data: { user: { id: scope.identity, contacts: { nextCursor: 'next' } } },
  revision: INITIAL_CACHE_REVISION,
};

beforeEach(() => {
  vi.clearAllMocks();
});

it('fetches only a bounded page and admits it under the original scope before returning its cursor', async () => {
  network.query.mockReturnValue({ toPromise: async () => ({ data }) });
  const commit = Promise.withResolvers<typeof cached>();
  const admitted = Promise.withResolvers<void>();
  const hydrateQuery = vi
    .fn<CacheHost['hydrateQuery']>()
    .mockImplementation(() => {
      admitted.resolve();
      return commit.promise;
    });
  const result = hydrateGraphqlContacts(
    { hydrateQuery },
    scope,
    null,
    new AbortController().signal
  );
  await admitted.promise;
  expect(network.query.mock.calls[0][0]).not.toContain('@cacheOnly');
  expect(network.query.mock.calls[0][1]).toEqual({ limit: 500, after: null });
  expect(hydrateQuery.mock.calls[0][0]).toMatchObject({
    hydrationScope: scope,
    identity: scope.identity,
    data,
  });
  expect(hydrateQuery.mock.calls[0][0].query).toContain('@cacheOnly');
  commit.resolve(cached);
  expect(await result).toEqual(cached.data);
});

it('does not write a late network response after its caller is disposed', async () => {
  const response = Promise.withResolvers<{ data: typeof data }>();
  network.query.mockReturnValue({ toPromise: () => response.promise });
  const hydrateQuery = vi.fn<CacheHost['hydrateQuery']>();
  const controller = new AbortController();
  const result = hydrateGraphqlContacts(
    { hydrateQuery },
    scope,
    null,
    controller.signal
  );
  controller.abort();
  response.resolve({ data });
  await expect(result).rejects.toThrow();
  expect(hydrateQuery).not.toHaveBeenCalled();
});

it('keeps exact reference fallback fetch-only and cancels obsolete pages', async () => {
  const response = Promise.withResolvers<{ data: typeof data }>();
  network.query.mockReturnValue({ toPromise: () => response.promise });
  const controller = new AbortController();
  const variables: ContactReferencePageQueryVariables = {
    limit: 500,
    after: 'next',
    search: 'Person',
    matching: 'EXACT',
  };
  const page = fetchContactReferencePage(variables, controller.signal);
  expect(network.query).toHaveBeenCalledWith(
    ContactReferencePageDocument,
    variables,
    {
      requestPolicy: 'network-only',
      fetchOptions: { signal: controller.signal },
    }
  );
  controller.abort();
  response.resolve({ data });
  await expect(page).rejects.toThrow();
});

it('does not turn a rejected cache admission into a successful checkpoint', async () => {
  network.query.mockReturnValue({ toPromise: async () => ({ data }) });
  const hydrateQuery = vi
    .fn<CacheHost['hydrateQuery']>()
    .mockRejectedValue(new Error('cache hydration scope changed'));
  await expect(
    hydrateGraphqlContacts(
      { hydrateQuery },
      scope,
      'after',
      new AbortController().signal
    )
  ).rejects.toThrow('scope changed');
});
