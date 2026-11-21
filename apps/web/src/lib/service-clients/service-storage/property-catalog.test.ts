import { thrownResultErrorHasCode } from '@core/util/result';
import { QueryClient } from '@tanstack/query-core';
import {
  type Client,
  CombinedError,
  createClient,
  createRequest,
  fetchExchange,
} from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  type PropertyCatalogDefinitionFieldsFragment,
  PropertyCatalogDefinitionsDocument,
  PropertyCatalogDefinitionsWithOptionsDocument,
  type PropertyCatalogOptionFieldsFragment,
  PropertyCatalogOptionsDocument,
  PropertyCatalogTagSetsDocument,
} from './graphql/generated/graphql';
import {
  listPropertyDefinitions,
  listPropertyOptions,
  listTagSets,
} from './property-catalog';

const network = vi.hoisted(() => ({ executeQuery: vi.fn() }));
// A test that needs urql's own client behaviour sets a real one here.
const transport = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => transport.client ?? network,
}));

const VIEWER = 'macro|viewer@example.com';
const TEAM = '00000000-0000-4000-8000-0000000000aa';
const CREATED = '2026-01-02T03:04:05Z';
const UPDATED = '2026-02-03T04:05:06Z';

function respond(data: unknown) {
  network.executeQuery.mockReturnValueOnce({
    toPromise: async () => ({ data, error: undefined }),
  });
}

// Each read is its own request for the document and variables given.
function expectRead(document: unknown, variables: unknown) {
  expect(network.executeQuery).toHaveBeenCalledWith(
    expect.objectContaining({ query: document, variables }),
    { requestPolicy: 'network-only' }
  );
}

function definition(
  overrides: Partial<PropertyCatalogDefinitionFieldsFragment> = {}
): PropertyCatalogDefinitionFieldsFragment {
  return {
    id: 'definition-1',
    owner: { scope: 'USER', principalId: VIEWER },
    displayName: 'Status',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    specificEntityType: 'TASK',
    isSystem: false,
    isMetadata: false,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

function option(
  overrides: Partial<PropertyCatalogOptionFieldsFragment> = {}
): PropertyCatalogOptionFieldsFragment {
  return {
    id: 'option-1',
    propertyDefinitionId: 'definition-1',
    displayOrder: 2,
    value: {
      __typename: 'GraphqlStringPropertyOptionValue',
      stringValue: 'Open',
    },
    color: '#ff0000',
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.client = undefined;
});

it('lists definitions in the REST shape, naming every owner', async () => {
  respond({
    user: {
      id: VIEWER,
      propertyDefinitions: [
        definition(),
        definition({
          id: 'definition-2',
          owner: { scope: 'TEAM', principalId: TEAM },
          specificEntityType: null,
        }),
        definition({
          id: 'definition-3',
          owner: { scope: 'SYSTEM', principalId: null },
          isSystem: true,
        }),
      ],
    },
  });

  const listed = await listPropertyDefinitions({
    scope: 'all',
    includeOptions: false,
    forEntityType: 'TASK',
  });

  expectRead(PropertyCatalogDefinitionsDocument, {
    scope: 'ALL',
    forEntityType: 'TASK',
  });
  expect(listed).toEqual([
    {
      id: 'definition-1',
      owner: { scope: 'user', user_id: VIEWER },
      display_name: 'Status',
      data_type: 'SELECT_STRING',
      is_multi_select: false,
      specific_entity_type: 'TASK',
      is_system: false,
      is_metadata: false,
      created_at: CREATED,
      updated_at: UPDATED,
    },
    expect.objectContaining({
      id: 'definition-2',
      owner: { scope: 'team', team_id: TEAM },
      specific_entity_type: null,
    }),
    expect.objectContaining({
      id: 'definition-3',
      owner: { scope: 'system' },
      is_system: true,
    }),
  ]);
});

it('lists definitions with their options when asked, keeping number values', async () => {
  respond({
    user: {
      id: VIEWER,
      propertyDefinitions: [
        {
          ...definition({ dataType: 'SELECT_NUMBER' }),
          options: [
            option({
              value: {
                __typename: 'GraphqlNumberPropertyOptionValue',
                numberValue: 1.5,
              },
              color: null,
            }),
          ],
        },
      ],
    },
  });

  const listed = await listPropertyDefinitions({
    scope: 'team',
    includeOptions: true,
  });

  expectRead(PropertyCatalogDefinitionsWithOptionsDocument, {
    scope: 'TEAM',
    forEntityType: null,
  });
  expect(listed).toEqual([
    {
      definition: expect.objectContaining({
        id: 'definition-1',
        data_type: 'SELECT_NUMBER',
      }),
      property_options: [
        {
          id: 'option-1',
          property_definition_id: 'definition-1',
          display_order: 2,
          value: { type: 'number', value: 1.5 },
          color: null,
          created_at: CREATED,
          updated_at: UPDATED,
        },
      ],
    },
  ]);
});

it('drops a definition whose owner the response cannot name', async () => {
  respond({
    user: {
      id: VIEWER,
      propertyDefinitions: [
        definition({ owner: { scope: 'USER', principalId: null } }),
      ],
    },
  });

  expect(
    await listPropertyDefinitions({ scope: 'user', includeOptions: false })
  ).toEqual([]);
});

it("lists one definition's options in the REST shape", async () => {
  respond({ user: { id: VIEWER, propertyOptions: [option()] } });

  const listed = await listPropertyOptions('definition-1');

  expectRead(PropertyCatalogOptionsDocument, {
    propertyDefinitionId: 'definition-1',
  });
  expect(listed).toEqual([
    {
      id: 'option-1',
      property_definition_id: 'definition-1',
      display_order: 2,
      value: { type: 'string', value: 'Open' },
      color: '#ff0000',
      created_at: CREATED,
      updated_at: UPDATED,
    },
  ]);
});

it('lists tag sets, leaving out the definition of an unprovisioned team set', async () => {
  respond({
    user: {
      id: VIEWER,
      tagSets: [
        {
          scope: 'USER',
          definition: definition({
            dataType: 'TAG',
            isMultiSelect: true,
            specificEntityType: null,
          }),
          options: [option({ color: null })],
        },
        { scope: 'TEAM', definition: null, options: [] },
      ],
    },
  });

  const sets = await listTagSets();

  expectRead(PropertyCatalogTagSetsDocument, {});
  expect(sets).toEqual([
    {
      scope: 'user',
      definition: {
        scope: 'user',
        user_id: VIEWER,
        id: 'definition-1',
        displayName: 'Status',
        dataType: 'TAG',
        isMultiSelect: true,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
      options: [
        {
          id: 'option-1',
          propertyDefinitionId: 'definition-1',
          displayOrder: 2,
          value: { type: 'string', value: 'Open' },
          color: null,
        },
      ],
    },
    { scope: 'team', options: [] },
  ]);
  expect(sets[1]).not.toHaveProperty('definition');
});

it('rejects with the GraphQL error instead of an empty list', async () => {
  const error = new CombinedError({
    graphQLErrors: ['definition is not visible'],
  });
  network.executeQuery.mockReturnValueOnce({
    toPromise: async () => ({ data: undefined, error }),
  });

  await expect(listPropertyOptions('hidden')).rejects.toBe(error);
});

it('rejects an auth failure with the code the retry policy reads', async () => {
  network.executeQuery.mockReturnValueOnce({
    toPromise: async () => ({
      data: undefined,
      error: new CombinedError({
        networkError: new Error('Unauthorized'),
        response: new Response(null, { status: 401 }),
      }),
    }),
  });

  await expect(listTagSets()).rejects.toSatisfy((error: unknown) =>
    thrownResultErrorHasCode(error, 'UNAUTHORIZED')
  );
});

it('gives every read a key of its own that no hashed operation can have', async () => {
  network.executeQuery.mockImplementation(() => ({
    toPromise: async () => ({
      data: { user: { id: 'viewer', tagSets: [] } },
      error: undefined,
    }),
  }));

  await listTagSets();
  await listTagSets();

  const keys: unknown[] = network.executeQuery.mock.calls.map(
    ([request]) => request.key
  );
  expect(new Set(keys).size).toBe(2);
  // urql's hashed keys are integers, however long the document.
  expect(
    Number.isInteger(createRequest(PropertyCatalogTagSetsDocument, {}).key)
  ).toBe(true);
  for (const key of keys) expect(Math.abs(Number(key) % 1)).toBe(0.5);
});

// A server whose catalog reads answer with the definitions there when the
// request arrives, held until `release`, through a real urql client.
function heldCatalogServer() {
  let names = ['Status'];
  let holding = true;
  const waiting: Array<() => void> = [];
  let arrivals = 0;
  const arrivalWaiters: Array<{ count: number; resolve: () => void }> = [];
  const fetch = vi.fn(async () => {
    const seen = names.map((displayName) =>
      definition({ id: displayName, displayName })
    );
    arrivals += 1;
    for (const waiter of arrivalWaiters.filter((w) => w.count <= arrivals))
      waiter.resolve();
    if (holding) await new Promise<void>((resolve) => waiting.push(resolve));
    return new Response(
      JSON.stringify({
        data: { user: { id: VIEWER, propertyDefinitions: seen } },
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  });
  const client: Client = createClient({
    url: 'https://dss.test/items/soup/graphql',
    exchanges: [fetchExchange],
    fetch,
    preferGetMethod: false,
  });
  return {
    client,
    fetch,
    write: (name: string) => {
      names = [...names, name];
    },
    /** Resolves once the `count`th read has reached the server. */
    arrived: (count: number) =>
      new Promise<void>((resolve) => {
        if (arrivals >= count) resolve();
        else arrivalWaiters.push({ count, resolve });
      }),
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

const ALL = { scope: 'all', includeOptions: false } as const;
const namesOf = (listed: Awaited<ReturnType<typeof listPropertyDefinitions>>) =>
  listed.map(
    (item) => ('definition' in item ? item.definition : item).display_name
  );

it('sends a read made after a write as its own request while an earlier read of the same list is in flight', async () => {
  const server = heldCatalogServer();
  transport.client = server.client;

  const before = listPropertyDefinitions(ALL);
  await server.arrived(1);
  server.write('Stage');
  const after = listPropertyDefinitions(ALL);
  // The first read is still held: a read that joined it, or waited for it,
  // never arrives and the test times out.
  await server.arrived(2);
  server.release();

  expect(namesOf(await before)).toEqual(['Status']);
  expect(namesOf(await after)).toEqual(['Status', 'Stage']);
  expect(server.fetch).toHaveBeenCalledTimes(2);
});

it('keeps a write in the list its invalidation refetches while an earlier refetch is in flight', async () => {
  const server = heldCatalogServer();
  transport.client = server.client;
  const queries = new QueryClient();
  const queryKey = ['properties', 'definitions', ALL];
  const queryFn = () => listPropertyDefinitions(ALL);
  server.release();
  await queries.fetchQuery({ queryKey, queryFn });

  // A refetch is pending (a first write's invalidation) when a second write
  // lands and invalidates the list again, which cancels and refetches.
  server.hold();
  const pending = queries.refetchQueries({ queryKey });
  await server.arrived(2);
  server.write('Stage');
  const refetched = queries.refetchQueries({ queryKey });
  // As above: a refetch that joined the held read never arrives.
  await server.arrived(3);
  server.release();
  await Promise.all([pending, refetched]);

  expect(namesOf(queries.getQueryData(queryKey) ?? [])).toEqual([
    'Status',
    'Stage',
  ]);
});
