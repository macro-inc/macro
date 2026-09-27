import type { PropertyOptionFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query }),
}));

import {
  fetchGraphqlPropertyDefinitions,
  fetchGraphqlPropertyOptions,
  mapGraphqlPropertyDefinition,
  mapGraphqlPropertyOption,
} from './definitions';

const option = {
  __typename: 'GraphqlPropertyOption',
  id: 'option-id',
  propertyDefinitionId: 'definition-id',
  displayOrder: 2,
  color: null,
  createdAt: '2026-09-22T00:00:00Z',
  updatedAt: '2026-09-22T01:00:00Z',
  value: {
    __typename: 'GraphqlStringPropertyOptionValue',
    stringValue: 'In Review',
  },
} satisfies PropertyOptionFieldsFragment;

const definition = {
  __typename: 'GraphqlPropertyDefinition',
  id: 'definition-id',
  displayName: 'Status',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  specificEntityType: null,
  isSystem: true,
  isMetadata: false,
  createdAt: option.createdAt,
  updatedAt: option.updatedAt,
  owner: { scope: 'SYSTEM', principalId: null },
  options: [option],
} satisfies Parameters<typeof mapGraphqlPropertyDefinition>[0];

beforeEach(() => query.mockReset());

describe('typed property definition reads', () => {
  it.each([
    ['user', 'USER'],
    ['team', 'TEAM'],
    ['system', 'SYSTEM'],
    ['all', 'ALL'],
  ] as const)(
    'preserves %s scope and entity filtering',
    async (scope, expected) => {
      query.mockReturnValue({
        toPromise: async () => ({
          data: { user: { propertyDefinitions: [definition] } },
        }),
      });
      const result = await fetchGraphqlPropertyDefinitions({
        scope,
        includeOptions: true,
        forEntityType: 'INITIATIVE',
      });
      expect(query.mock.calls[0][1]).toEqual({
        scope: expected,
        includeOptions: true,
        forEntityType: 'INITIATIVE',
      });
      expect(result[0]).toMatchObject({
        definition: { id: 'definition-id', owner: { scope: 'system' } },
        property_options: [
          { id: 'option-id', property_definition_id: 'definition-id' },
        ],
      });
    }
  );

  it('returns the same plain definition shape when options were not requested', () => {
    const result = mapGraphqlPropertyDefinition(definition, false);
    expect(result).toMatchObject({
      id: 'definition-id',
      data_type: 'SELECT_STRING',
    });
    expect(result).not.toHaveProperty('property_options');
  });

  it.each([
    ['USER', 'user', 'user_id'],
    ['TEAM', 'team', 'team_id'],
  ] as const)('preserves %s ownership', (scope, expected, field) => {
    expect(
      mapGraphqlPropertyDefinition(
        {
          ...definition,
          isSystem: false,
          owner: { scope, principalId: 'principal-id' },
        },
        false
      )
    ).toMatchObject({ owner: { scope: expected, [field]: 'principal-id' } });
  });

  it('keeps numeric and string option values typed', () => {
    expect(mapGraphqlPropertyOption(option).value).toEqual({
      type: 'string',
      value: 'In Review',
    });
    expect(
      mapGraphqlPropertyOption({
        ...option,
        value: {
          __typename: 'GraphqlNumberPropertyOptionValue',
          numberValue: 3,
        },
      }).value
    ).toEqual({ type: 'number', value: 3 });
  });

  it('propagates permission errors instead of returning an empty catalog', async () => {
    const error = new Error('Definition is not visible');
    query.mockReturnValue({ toPromise: async () => ({ error }) });
    await expect(fetchGraphqlPropertyOptions('definition-id')).rejects.toBe(
      error
    );
  });
});
