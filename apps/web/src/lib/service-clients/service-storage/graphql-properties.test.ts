import { ENABLE_GRAPHQL_SOUP } from '@core/constant/featureFlags';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { propertiesServiceClient } from '../service-properties/client';
import type { SetPropertyValue } from '../service-properties/generated/schemas/setPropertyValue';
import type { SoupPropertyFieldsFragment } from './graphql/generated/graphql';
import {
  setEntityProperty,
  toGraphqlPropertyEntityType,
  toGraphqlSetPropertyValue,
} from './graphql-properties';
import { getGraphqlSoupClient } from './graphql-soup';

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_SOUP: vi.fn(() => false),
}));

vi.mock('../service-properties/client', () => ({
  propertiesServiceClient: {
    setEntityProperty: vi.fn(),
  },
}));

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const restSetEntityProperty = vi.mocked(
  propertiesServiceClient.setEntityProperty
);
const flag = vi.mocked(ENABLE_GRAPHQL_SOUP);

type MutationResult = { data?: unknown; error?: unknown };

function mockGraphqlClient(result: MutationResult) {
  const mutation = vi.fn(() => ({
    toPromise: async () => result,
  }));
  vi.mocked(getGraphqlSoupClient).mockReturnValue({ mutation } as never);
  return mutation;
}

const okRestResult = { isErr: () => false, value: { success: true } } as never;

describe('toGraphqlSetPropertyValue', () => {
  it('converts every REST variant to the one-of input', () => {
    const cases: Array<[SetPropertyValue | null, unknown]> = [
      [null, null],
      [{ type: 'boolean', value: true }, { boolean: true }],
      [{ type: 'date', value: '2026-07-10' }, { date: '2026-07-10' }],
      [{ type: 'number', value: 4.5 }, { number: 4.5 }],
      [{ type: 'string', value: 'hi' }, { string: 'hi' }],
      [
        { type: 'select_option', option_id: 'opt-1' },
        { selectOption: 'opt-1' },
      ],
      [
        { type: 'multi_select_option', option_ids: ['a', 'b'] },
        { multiSelectOption: ['a', 'b'] },
      ],
      [
        {
          type: 'entity_reference',
          reference: {
            entity_id: 'doc-1',
            entity_type: 'DOCUMENT',
            specific_message_id: 'msg-1',
          },
        },
        {
          entityReference: {
            entityId: 'doc-1',
            entityType: 'DOCUMENT',
            specificMessageId: 'msg-1',
          },
        },
      ],
      [
        {
          type: 'multi_entity_reference',
          references: [{ entity_id: 'u-1', entity_type: 'USER' }],
        },
        {
          multiEntityReference: [
            { entityId: 'u-1', entityType: 'USER', specificMessageId: null },
          ],
        },
      ],
      [{ type: 'link', url: 'https://a' }, { link: 'https://a' }],
      [
        { type: 'multi_link', urls: ['https://a', 'https://b'] },
        { multiLink: ['https://a', 'https://b'] },
      ],
    ];
    for (const [input, expected] of cases) {
      expect(toGraphqlSetPropertyValue(input)).toEqual(expected);
    }
  });
});

describe('toGraphqlPropertyEntityType', () => {
  it('maps every REST entity type', () => {
    expect(toGraphqlPropertyEntityType('DOCUMENT')).toBe('DOCUMENT');
    expect(toGraphqlPropertyEntityType('TASK')).toBe('TASK');
    expect(toGraphqlPropertyEntityType('COMPANY')).toBe('COMPANY');
    expect(toGraphqlPropertyEntityType('CALL_RECORD')).toBe('CALL_RECORD');
  });
});

describe('setEntityProperty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flag.mockReturnValue(false);
  });

  const args = {
    entityType: 'DOCUMENT' as const,
    entityId: 'doc-1',
    propertyDefinitionId: 'def-1',
    value: { type: 'string', value: 'hi' } satisfies SetPropertyValue,
  };

  it('uses the REST PUT when the flag is disabled', async () => {
    restSetEntityProperty.mockResolvedValue(okRestResult);
    const mutation = mockGraphqlClient({ data: undefined });

    await setEntityProperty(args);

    expect(restSetEntityProperty).toHaveBeenCalledWith({
      entity_type: 'DOCUMENT',
      entity_id: 'doc-1',
      property_id: 'def-1',
      body: { value: { type: 'string', value: 'hi' } },
    });
    expect(mutation).not.toHaveBeenCalled();
  });

  it('propagates REST errors as throws', async () => {
    restSetEntityProperty.mockResolvedValue({
      isErr: () => true,
      error: [{ code: 'boom', message: 'boom' }],
    } as never);

    await expect(setEntityProperty(args)).rejects.toThrow();
  });

  it('executes the GraphQL mutation when the flag is enabled', async () => {
    flag.mockReturnValue(true);
    const property = { id: 'prop-1' } as SoupPropertyFieldsFragment;
    const mutation = mockGraphqlClient({
      data: { setEntityProperty: property },
    });

    const result = await setEntityProperty(args);

    expect(restSetEntityProperty).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledOnce();
    const [, variables, context] = mutation.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
    ];
    expect(variables).toEqual({
      input: {
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        propertyDefinitionId: 'def-1',
        value: { string: 'hi' },
      },
    });
    expect(context).toBeUndefined();
    expect(result).toBe(property);
  });

  it('attaches the optimistic response to the mutation context', async () => {
    flag.mockReturnValue(true);
    const optimistic = { id: 'prop-1' } as SoupPropertyFieldsFragment;
    const mutation = mockGraphqlClient({
      data: { setEntityProperty: optimistic },
    });

    await setEntityProperty({ ...args, optimisticProperty: optimistic });

    const [, , context] = mutation.mock.calls[0] as unknown as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(context).toEqual({
      normalizedCacheOptimistic: {
        optimisticResponse: { setEntityProperty: optimistic },
      },
    });
  });

  it('throws on GraphQL errors', async () => {
    flag.mockReturnValue(true);
    mockGraphqlClient({ error: new Error('mutation failed') });

    await expect(setEntityProperty(args)).rejects.toThrow('mutation failed');
  });
});
