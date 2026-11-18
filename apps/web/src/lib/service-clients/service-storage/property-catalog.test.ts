import { thrownResultErrorHasCode } from '@core/util/result';
import { CombinedError } from '@urql/core';
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

const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
}));

const VIEWER = 'macro|viewer@example.com';
const TEAM = '00000000-0000-4000-8000-0000000000aa';
const CREATED = '2026-01-02T03:04:05Z';
const UPDATED = '2026-02-03T04:05:06Z';

function respond(data: unknown) {
  network.query.mockReturnValueOnce({
    toPromise: async () => ({ data, error: undefined }),
  });
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

  expect(network.query).toHaveBeenCalledWith(
    PropertyCatalogDefinitionsDocument,
    { scope: 'ALL', forEntityType: 'TASK' },
    { requestPolicy: 'network-only' }
  );
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

  expect(network.query).toHaveBeenCalledWith(
    PropertyCatalogDefinitionsWithOptionsDocument,
    { scope: 'TEAM', forEntityType: null },
    { requestPolicy: 'network-only' }
  );
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

  expect(network.query).toHaveBeenCalledWith(
    PropertyCatalogOptionsDocument,
    { propertyDefinitionId: 'definition-1' },
    { requestPolicy: 'network-only' }
  );
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

  expect(network.query).toHaveBeenCalledWith(
    PropertyCatalogTagSetsDocument,
    {},
    { requestPolicy: 'network-only' }
  );
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
  network.query.mockReturnValueOnce({
    toPromise: async () => ({ data: undefined, error }),
  });

  await expect(listPropertyOptions('hidden')).rejects.toBe(error);
});

it('rejects an auth failure with the code the retry policy reads', async () => {
  network.query.mockReturnValueOnce({
    toPromise: async () => ({
      data: undefined,
      error: new CombinedError({
        networkError: new Error('Unauthorized'),
        response: new Response(null, { status: 401 }),
      }),
    }),
  });

  const rejection = listTagSets().catch((error: unknown) => error);
  expect(thrownResultErrorHasCode(await rejection, 'UNAUTHORIZED')).toBe(true);
});
