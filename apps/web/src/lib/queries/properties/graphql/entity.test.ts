import type { Property } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { validate as validateUuid } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';

const graphqlClientState = vi.hoisted(() => ({
  current: undefined as Client | undefined,
}));
const mapGraphqlPropertiesMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    if (!graphqlClientState.current) throw new Error('GraphQL client not set');
    return graphqlClientState.current;
  },
  getGraphqlCacheHost: () => undefined,
  mapGraphqlProperties: mapGraphqlPropertiesMock,
}));

import {
  buildEntityPropertiesInput,
  createGraphqlAddEntityPropertyMutation,
  createGraphqlBulkSaveEntityPropertiesMutation,
  createGraphqlEntityPropertiesQuery,
  entityPropertyOptimisticMutationUuid,
  mapGraphqlEntityProperties,
} from './entity';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

type ControlledRequest = {
  operation: Operation;
  next: (result?: Pick<OperationResult, 'data' | 'error'>) => void;
};

function makeControlledClient() {
  const requests: ControlledRequest[] = [];
  const exchange: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        const subject = makeSubject<OperationResult>();
        requests.push({
          operation,
          next: (result = {}) =>
            subject.next({
              operation,
              data: result.data,
              error: result.error,
              stale: false,
              hasNext: false,
            }),
        });
        return subject.source;
      })
    );
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
  graphqlClientState.current = client;
  return { client, requests };
}

const EMPTY_DATA = {
  user: { id: 'user-1', soup: { items: [] } },
};
const NIL_FILTERS = {
  calendarEventFilter: { literal: { id: NIL_ENTITY_ID } },
  documentFilter: { literal: { id: NIL_ENTITY_ID } },
  projectFilter: { literal: { projectIdSelf: NIL_ENTITY_ID } },
  chatFilter: { literal: { chatId: NIL_ENTITY_ID } },
  emailFilter: { tree: { literal: { threadId: NIL_ENTITY_ID } } },
  channelFilter: { literal: { channelId: NIL_ENTITY_ID } },
  channelThreadFilter: { literal: { threadId: NIL_ENTITY_ID } },
  callFilter: { literal: { callId: NIL_ENTITY_ID } },
  crmCompanyFilter: { literal: { id: NIL_ENTITY_ID } },
  foreignEntityFilter: { literal: { id: NIL_ENTITY_ID } },
};

function initialInput(entityType: EntityType) {
  const input = buildEntityPropertiesInput(entityType, 'entity-1');
  if (!input || !('initial' in input) || !input.initial) {
    throw new Error(`Expected an initial Soup input for ${entityType}`);
  }
  return input.initial;
}

describe('buildEntityPropertiesInput', () => {
  it.each([
    ['DOCUMENT', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['TASK', 'documentFilter', { literal: { id: 'entity-1' } }],
    ['PROJECT', 'projectFilter', { literal: { projectIdSelf: 'entity-1' } }],
    ['CHAT', 'chatFilter', { literal: { chatId: 'entity-1' } }],
    ['THREAD', 'emailFilter', { tree: { literal: { threadId: 'entity-1' } } }],
    ['CHANNEL', 'channelFilter', { literal: { channelId: 'entity-1' } }],
    ['CALL_RECORD', 'callFilter', { literal: { callId: 'entity-1' } }],
    ['COMPANY', 'crmCompanyFilter', { literal: { id: 'entity-1' } }],
    ['CALENDAR_EVENT', 'calendarEventFilter', { literal: { id: 'entity-1' } }],
  ] as const)(
    'targets one %s and excludes the other Soup branches',
    (entityType, filterKey, expectedFilter) => {
      const input = initialInput(entityType);

      expect(input).toMatchObject({
        limit: 1,
        expand: true,
        sortMethod: 'UPDATED_AT',
        emailView: 'ALL',
      });
      expect(input.filters).toEqual({
        ...NIL_FILTERS,
        [filterKey]: expectedFilter,
      });
    }
  );

  it('returns undefined for USER because users are not represented in Soup', () => {
    expect(buildEntityPropertiesInput('USER', 'user-1')).toBeUndefined();
  });
});

describe('mapGraphqlEntityProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps only the requested entity properties', () => {
    const property = { id: 'property-1' };
    const mapped = [{ id: 'property-1' }] as SoupProperty[];
    mapGraphqlPropertiesMock.mockReturnValue(mapped);

    expect(
      mapGraphqlEntityProperties(
        {
          user: {
            id: 'user-1',
            soup: {
              items: [
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'other-entity',
                  properties: [],
                },
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'entity-1',
                  properties: [property],
                },
              ],
            },
          },
        } as never,
        'entity-1'
      )
    ).toBe(mapped);
    expect(mapGraphqlPropertiesMock).toHaveBeenCalledWith([property]);
  });

  it('retains the not-yet-loaded distinction', () => {
    expect(mapGraphqlEntityProperties(undefined, 'entity-1')).toBeUndefined();
    expect(mapGraphqlPropertiesMock).not.toHaveBeenCalled();
  });
});

describe('entityPropertyOptimisticMutationUuid', () => {
  it('is stable per property slot and distinct across slots', () => {
    const args = {
      entityType: 'DOCUMENT' as const,
      entityId: 'document-1',
      propertyDefinitionId: 'property-1',
    };
    const uuid = entityPropertyOptimisticMutationUuid(args);

    expect(validateUuid(uuid)).toBe(true);
    expect(entityPropertyOptimisticMutationUuid(args)).toBe(uuid);
    expect(
      entityPropertyOptimisticMutationUuid({
        ...args,
        propertyDefinitionId: 'property-2',
      })
    ).not.toBe(uuid);
    expect(
      entityPropertyOptimisticMutationUuid({
        ...args,
        entityId: 'document-1:property',
        propertyDefinitionId: '1',
      })
    ).not.toBe(
      entityPropertyOptimisticMutationUuid({
        ...args,
        entityId: 'document-1',
        propertyDefinitionId: 'property:1',
      })
    );
  });
});

describe('GraphQL entity property mutations', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => dispose?.());

  it('executes add mutations through the urql-solid adapter', async () => {
    const property = { id: 'property-1' };
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: async () => ({
          operation: {
            kind: 'mutation',
            context,
          } as Operation,
          data: { setEntityProperty: property },
          stale: false,
          hasNext: false,
        }),
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    let result!: ReturnType<typeof createGraphqlAddEntityPropertyMutation>;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      result = createGraphqlAddEntityPropertyMutation();
    });

    await expect(
      result.mutateAsync({
        entityType: 'TASK',
        entityId: 'task-1',
        propertyDefinitionId: 'definition-1',
      })
    ).resolves.toMatchObject({
      data: { setEntityProperty: property },
    });
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        input: {
          entityType: 'DOCUMENT',
          entityId: 'task-1',
          propertyDefinitionId: 'definition-1',
          value: null,
        },
      },
      {}
    );
  });

  it('returns optimistic data for saves queued behind a replacement', async () => {
    const property = {
      propertyId: 'assignment-1',
      propertyDefinitionId: 'definition-1',
      displayName: 'Status',
      valueType: 'STRING',
      isMultiSelect: false,
      isSystemProperty: false,
      isMetadata: false,
    } as Property;
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: async () => ({
          operation: {
            kind: 'mutation',
            context,
          } as Operation,
          data: undefined,
          extensions: {
            normalizedCacheMutationDisposition: {
              kind: 'superseded',
              transactionId: 'transaction-1',
              replacementTransactionId: 'transaction-2',
            },
          },
          stale: false,
          hasNext: false,
        }),
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    let result!: ReturnType<
      typeof createGraphqlBulkSaveEntityPropertiesMutation
    >;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      result = createGraphqlBulkSaveEntityPropertiesMutation();
    });

    await expect(
      result.mutateAsync({
        properties: [
          {
            entityType: 'DOCUMENT',
            entityId: 'document-1',
            property,
            apiValues: { valueType: 'STRING', value: 'doing' },
          },
        ],
      })
    ).resolves.toMatchObject({
      data: {
        setEntityProperty: expect.objectContaining({ id: 'assignment-1' }),
      },
      extensions: {
        normalizedCacheMutationDisposition: {
          kind: 'superseded',
          transactionId: 'transaction-1',
          replacementTransactionId: 'transaction-2',
        },
      },
    });
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        input: {
          entityType: 'DOCUMENT',
          entityId: 'document-1',
          propertyDefinitionId: 'definition-1',
          value: { string: 'doing' },
        },
      },
      expect.objectContaining({
        normalizedCacheOptimistic: expect.objectContaining({
          optimisticResponse: {
            setEntityProperty: expect.objectContaining({ id: 'assignment-1' }),
          },
        }),
      })
    );
  });
});

describe('createGraphqlBulkSaveEntityPropertiesMutation', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => dispose?.());

  it('runs bulk side effects through mutation callbacks', async () => {
    const events: string[] = [];
    const property = {
      propertyId: 'assignment-1',
      propertyDefinitionId: 'definition-1',
      displayName: 'Status',
      valueType: 'STRING',
      isMultiSelect: false,
      isSystemProperty: false,
      isMetadata: false,
    } as Property;
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: async () => ({
          operation: { kind: 'mutation', context } as Operation,
          data: { setEntityProperty: { id: 'assignment-1' } },
          stale: false,
          hasNext: false,
        }),
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    let result!: ReturnType<
      typeof createGraphqlBulkSaveEntityPropertiesMutation<{ source: string }>
    >;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      result = createGraphqlBulkSaveEntityPropertiesMutation({
        onMutate: () => {
          events.push('mutate');
          return { source: 'test' };
        },
        onCommitted: () => {
          events.push('committed');
        },
        onSuccess: (_input, context) => {
          events.push(`success:${context?.source}`);
        },
        onSettled: (error, _input, context) => {
          events.push(`settled:${error?.message ?? context?.source}`);
        },
      });
    });

    await result.mutateAsync({
      properties: [
        {
          entityType: 'DOCUMENT',
          entityId: 'document-1',
          property,
          apiValues: { valueType: 'STRING', value: 'doing' },
        },
      ],
    });

    expect(events).toEqual([
      'mutate',
      'committed',
      'success:test',
      'settled:test',
    ]);
  });
});

describe('createGraphqlEntityPropertiesQuery', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    graphqlClientState.current = undefined;
    mapGraphqlPropertiesMock.mockReturnValue([]);
  });

  afterEach(() => dispose?.());

  it('owns the live operation and refetches it network-only', async () => {
    const { requests } = makeControlledClient();
    const [entityType] = createSignal<EntityType>('DOCUMENT');
    const [entityId] = createSignal('entity-1');
    const [enabled] = createSignal(true);
    let query!: ReturnType<typeof createGraphqlEntityPropertiesQuery>;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      query = createGraphqlEntityPropertiesQuery({
        entityType,
        entityId,
        enabled,
      });
    });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.operation.context.requestPolicy).toBe(
      'cache-and-network'
    );
    requests[0]?.next({ data: EMPTY_DATA });
    await vi.waitFor(() => expect(query.result.data).toEqual([]));

    const refetch = query.refetch();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.operation.context.requestPolicy).toBe('network-only');
    requests[1]?.next({ data: EMPTY_DATA });
    await refetch;
  });

  it('does not start an operation for unsupported entity types', () => {
    const { requests } = makeControlledClient();
    const [entityType] = createSignal<EntityType>('USER');
    const [entityId] = createSignal('user-1');
    const [enabled] = createSignal(true);

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const query = createGraphqlEntityPropertiesQuery({
        entityType,
        entityId,
        enabled,
      });
      expect(query.isEnabled()).toBe(false);
    });

    expect(requests).toHaveLength(0);
  });
});
