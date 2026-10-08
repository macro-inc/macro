import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import type { Property } from '@property/types';
import { registerGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { GroupSoupDocument } from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { validate as validateUuid } from 'uuid';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';

const graphqlClientState = vi.hoisted(() => ({
  current: undefined as Client | undefined,
  host: undefined as CacheHost | undefined,
}));
const mapGraphqlPropertiesMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    if (!graphqlClientState.current) throw new Error('GraphQL client not set');
    return graphqlClientState.current;
  },
  getGraphqlCacheHost: () => graphqlClientState.host,
  mapGraphqlProperties: mapGraphqlPropertiesMock,
}));

import {
  buildEntityPropertiesInput,
  createGraphqlAddEntityPropertyMutation,
  createGraphqlBulkSaveEntityPropertiesMutation,
  createGraphqlEntityPropertiesQuery,
  entityPropertyOptimisticMutationUuid,
  mapGraphqlEntityProperties,
  refetchGraphqlInitiativeProperties,
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

function makeSettlementHost() {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  const unsubscribe = vi.fn();
  const unsubscribeGeneration = vi.fn();
  graphqlClientState.host = {
    inspectQuery: vi.fn(async () => []),
    inspectQueryVariants: vi.fn(async () => []),
    onMutationSettled(callback: (settlement: MutationSettlement) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        unsubscribe();
      };
    },
    onCacheGenerationChanged: () => unsubscribeGeneration,
  } as unknown as CacheHost;
  return {
    emit: (settlement: MutationSettlement) => {
      for (const callback of listeners) callback(settlement);
    },
    unsubscribe,
    unsubscribeGeneration,
  };
}

afterEach(() => {
  graphqlClientState.host = undefined;
});

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
    ['INITIATIVE', 'initiativeFilter', { literal: { id: 'entity-1' } }],
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
    expect(
      mapGraphqlEntityProperties(
        { user: { id: 'user-1' } } as never,
        'entity-1'
      )
    ).toBeUndefined();
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

  it('retains the queued acknowledgement but waits for the replacement to commit', async () => {
    const settlements = makeSettlementHost();
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

    const pending = result.mutateAsync({
      properties: [
        {
          entityType: 'DOCUMENT',
          entityId: 'document-1',
          property,
          apiValues: { valueType: 'STRING', value: 'doing' },
        },
      ],
    });
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(result.isPending).toBe(true);
    settlements.emit({ transactionId: 'transaction-2', status: 'committed' });
    await expect(pending).resolves.toMatchObject({
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

  it('installs every bulk layer before the first HTTP result, while retaining enqueue order', async () => {
    const onCommitted = vi.fn();
    const acknowledgements: Array<() => void> = [];
    const responses: Array<() => void> = [];
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: () =>
          new Promise((resolve) => {
            acknowledgements.push(
              context.normalizedCacheOptimisticEnqueued as () => void
            );
            responses.push(() =>
              resolve({
                operation: { kind: 'mutation', context },
                data: { setEntityProperty: { id: 'assignment' } },
                stale: false,
                hasNext: false,
              })
            );
          }),
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    const save = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGraphqlBulkSaveEntityPropertiesMutation({ onCommitted });
    });
    const property = {
      propertyId: 'assignment',
      propertyDefinitionId: 'priority',
      displayName: 'Priority',
      valueType: 'SELECT_STRING',
      isMultiSelect: false,
    } as Property;
    const pending = save.mutateAsync({
      properties: ['task-1', 'task-2'].map((entityId) => ({
        entityId,
        entityType: 'TASK',
        property,
        apiValues: { valueType: 'SELECT_STRING', values: ['urgent'] },
      })),
    });
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    // Preparing the next relation recipe must wait for cache installation.
    expect(onCommitted).not.toHaveBeenCalled();
    acknowledgements[0]();
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
    expect(onCommitted).not.toHaveBeenCalled();
    acknowledgements[1]();
    expect(save.isPending).toBe(true);
    responses[1]();
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    expect(save.isPending).toBe(true);
    responses[0]();
    await pending;
    expect(onCommitted).toHaveBeenCalledTimes(2);
    expect(save.isPending).toBe(false);
  });

  it('prepares a bulk grouped edit once per active page without cache inspection', async () => {
    makeSettlementHost();
    const input = {
      initial: {
        groupBy: {
          field: 'PROPERTY' as const,
          propertyDefinitionId: 'priority',
        },
      },
    };
    onTestFinished(
      registerGraphqlSoupRevalidations(() => [
        { document: GroupSoupDocument, variables: { input } },
        { document: GroupSoupDocument, variables: { input } },
      ])
    );
    const readQuery = vi.fn(async () => ({
      kind: 'hit' as const,
      data: {
        user: {
          groupSoup: {
            bins: [
              {
                key: 'low',
                totalCount: 2,
                nextCursor: null,
                items: ['task-1', 'task-2'].map((id) => ({
                  __typename: 'GraphqlSoupDocument',
                  id,
                })),
              },
            ],
          },
        },
      },
    }));
    const inspect = vi.fn(async () => {
      throw new Error('query inspection variant count 129 exceeds limit 128');
    });
    graphqlClientState.host = {
      ...graphqlClientState.host,
      readQuery,
      inspectQuery: inspect,
      inspectQueryVariants: inspect,
    } as unknown as CacheHost;
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: async () => {
          (context.normalizedCacheOptimisticEnqueued as () => void)();
          return {
            operation: { kind: 'mutation', context },
            data: { setEntityProperty: { id: 'assignment' } },
            stale: false,
            hasNext: false,
          };
        },
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    const save = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGraphqlBulkSaveEntityPropertiesMutation();
    });
    await save.mutateAsync({
      properties: ['task-1', 'task-2'].map((entityId) => ({
        entityId,
        entityType: 'TASK',
        property: {
          propertyId: `assignment-${entityId}`,
          propertyDefinitionId: 'priority',
          displayName: 'Priority',
          valueType: 'SELECT_STRING',
          value: ['low'],
          isMultiSelect: false,
        } as Property,
        apiValues: { valueType: 'SELECT_STRING', values: ['urgent'] },
      })),
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(readQuery).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledTimes(2);
    for (const [index, call] of mutation.mock.calls.entries()) {
      expect(call[2]).toMatchObject({
        normalizedCacheOptimistic: {
          linkPatches: [
            {
              operation: {
                kind: 'removeEmbeddedLink',
                entityKey: `GraphqlSoupDocument:task-${index + 1}`,
              },
            },
            {
              operation: {
                kind: 'upsertEmbeddedLink',
                entityKey: `GraphqlSoupDocument:task-${index + 1}`,
              },
            },
          ],
          revalidations: [
            {
              operationName: 'GroupSoupMembership',
              variablesJson: JSON.stringify({ input }),
            },
          ],
        },
      });
    }
  });

  it.each(['committed', 'permanently-failed'] as const)(
    'waits for later queued saves and reports their %s settlement',
    async (status) => {
      const settlements = makeSettlementHost();
      const onCommitted = vi.fn();
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const onSettled = vi.fn();
      let resolveFirst!: () => void;
      let submitted = 0;
      const mutation = vi.fn(
        (
          _document: unknown,
          _variables: unknown,
          context: Record<string, unknown>
        ) => ({
          toPromise: async () => {
            const index = submitted++;
            (context.normalizedCacheOptimisticEnqueued as () => void)();
            if (index === 0) {
              await new Promise<void>((resolve) => {
                resolveFirst = resolve;
              });
            }
            return {
              operation: { kind: 'mutation', context } as Operation,
              data: { setEntityProperty: { id: `assignment-${index}` } },
              extensions: {
                normalizedCacheMutationDisposition:
                  index === 0
                    ? { kind: 'committed', transactionId: 'first' }
                    : { kind: 'queued', transactionId: 'second' },
              },
              stale: false,
              hasNext: false,
            };
          },
        })
      );
      graphqlClientState.current = { mutation } as unknown as Client;
      const save = createRoot((rootDispose) => {
        dispose = rootDispose;
        return createGraphqlBulkSaveEntityPropertiesMutation({
          onCommitted,
          onSuccess,
          onError,
          onSettled,
        });
      });
      const property = {
        propertyId: 'assignment',
        propertyDefinitionId: 'priority',
        displayName: 'Priority',
        valueType: 'SELECT_STRING',
        isMultiSelect: false,
      } as Property;
      const pending = save.mutateAsync({
        properties: ['task-1', 'task-2'].map((entityId) => ({
          entityId,
          entityType: 'TASK',
          property,
          apiValues: { valueType: 'SELECT_STRING', values: ['urgent'] },
        })),
      });
      await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
      resolveFirst();
      await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
      expect(save.isPending).toBe(true);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onSettled).not.toHaveBeenCalled();
      settlements.emit(
        status === 'committed'
          ? { transactionId: 'second', status }
          : {
              transactionId: 'second',
              status,
              error: 'Second property rejected',
            }
      );
      const result = await pending;
      expect(save.isPending).toBe(false);
      if (status === 'committed') {
        expect(result.error).toBeUndefined();
        expect(onCommitted).toHaveBeenCalledTimes(2);
        expect(onCommitted).toHaveBeenLastCalledWith(
          expect.objectContaining({ entityId: 'task-2' }),
          { kind: 'committed' }
        );
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
      } else {
        expect(result.error?.message).toContain('Second property rejected');
        expect(onCommitted).toHaveBeenCalledOnce();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
      }
      expect(onSettled).toHaveBeenCalledOnce();
      expect(settlements.unsubscribe).toHaveBeenCalledOnce();
      expect(settlements.unsubscribeGeneration).toHaveBeenCalledOnce();
    }
  );

  it('links an unset task property even when global Soup inspection exceeds its budget', async () => {
    makeSettlementHost();
    graphqlClientState.host = {
      ...graphqlClientState.host,
      inspectQuery: vi.fn(async () => {
        throw new Error('query inspection variant count 129 exceeds limit 128');
      }),
      inspectQueryVariants: vi.fn(async () => []),
    } as unknown as CacheHost;
    const mutation = vi.fn(
      (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => ({
        toPromise: async () => ({
          operation: { kind: 'mutation', context },
          data: { setEntityProperty: { id: 'server-assignment' } },
          stale: false,
          hasNext: false,
        }),
      })
    );
    graphqlClientState.current = { mutation } as unknown as Client;
    const save = createRoot((rootDispose) => {
      dispose = rootDispose;
      return createGraphqlBulkSaveEntityPropertiesMutation();
    });
    try {
      await save.mutateAsync({
        properties: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            property: {
              propertyId: 'pending:priority',
              propertyDefinitionId: 'priority',
              displayName: 'Priority',
              valueType: 'SELECT_STRING',
              isMultiSelect: false,
              value: null,
            } as Property,
            apiValues: { valueType: 'SELECT_STRING', values: ['urgent'] },
          },
        ],
      });
      expect(mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          normalizedCacheOptimistic: expect.objectContaining({
            optimisticResponse: {
              setEntityProperty: expect.objectContaining({
                id: 'optimistic-property:DOCUMENT:task-1:priority',
                value: {
                  __typename: 'GraphqlSelectOptionPropertyValue',
                  optionIds: ['urgent'],
                },
              }),
            },
            revalidations: [
              expect.objectContaining({
                operationName: 'EntityProperties',
                variablesJson: JSON.stringify({
                  input: buildEntityPropertiesInput('TASK', 'task-1'),
                }),
              }),
            ],
            linkPatches: [
              expect.objectContaining({
                recordRoot: {
                  fragmentName: 'PropertyAssignmentParent',
                  entityKey: 'GraphqlSoupDocument:task-1',
                },
                path: [{ field: 'properties' }],
                operation: {
                  kind: 'upsertByField',
                  entityKey:
                    'GraphqlProperty:optimistic-property:DOCUMENT:task-1:priority',
                  whereField: 'propertyDefinitionId',
                  equals: 'priority',
                },
              }),
            ],
          }),
        })
      );
      expect(graphqlClientState.host.inspectQuery).not.toHaveBeenCalled();
    } finally {
      graphqlClientState.host = undefined;
    }
  });

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

  it('saves values requested by an editor that has already closed', async () => {
    const onSettled = vi.fn();
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
    let save!: ReturnType<typeof createGraphqlBulkSaveEntityPropertiesMutation>;
    // The project picker closes before its save settles, taking the owner of
    // these mutations with it.
    createRoot((rootDispose) => {
      save = createGraphqlBulkSaveEntityPropertiesMutation({ onSettled });
      rootDispose();
    });

    const result = await save.mutateAsync({
      properties: [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          property: {
            propertyId: 'assignment-1',
            propertyDefinitionId: 'project',
            displayName: 'Project',
            valueType: 'ENTITY',
            isMultiSelect: false,
          } as Property,
          apiValues: {
            valueType: 'ENTITY',
            refs: [{ entity_id: 'project-1', entity_type: 'INITIATIVE' }],
          },
        },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        input: {
          entityType: 'DOCUMENT',
          entityId: 'task-1',
          propertyDefinitionId: 'project',
          value: {
            entityReference: {
              entityId: 'project-1',
              entityType: 'INITIATIVE',
              specificMessageId: null,
            },
          },
        },
      },
      expect.anything()
    );
    expect(onSettled).toHaveBeenCalledOnce();
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

  it('loads initiative properties through Soup and clears prior values on navigation', async () => {
    const { requests } = makeControlledClient();
    const [entityId, setEntityId] = createSignal('initiative-1');
    let query!: ReturnType<typeof createGraphqlEntityPropertiesQuery>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      query = createGraphqlEntityPropertiesQuery({
        entityType: () => 'INITIATIVE',
        entityId,
        enabled: () => true,
      });
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(query.isEnabled()).toBe(true);
    expect(requests[0].operation.variables).toEqual({
      input: buildEntityPropertiesInput('INITIATIVE', 'initiative-1'),
    });
    requests[0].next({
      data: {
        user: {
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupInitiative',
                id: 'initiative-1',
                properties: [],
              },
            ],
          },
        },
      },
    });
    await vi.waitFor(() => expect(query.result.data).toEqual([]));
    setEntityId('initiative-2');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].operation.variables).toEqual({
      input: buildEntityPropertiesInput('INITIATIVE', 'initiative-2'),
    });
    expect(query.result.data).toBeUndefined();
    requests[1].next({
      data: {
        user: {
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupInitiative',
                id: 'initiative-2',
                properties: [],
              },
            ],
          },
        },
      },
    });
    await vi.waitFor(() => expect(query.result.data).toEqual([]));
  });

  it('refreshes the mounted project sidebar when a first property value is attached without a normalized cache', async () => {
    const { requests } = makeControlledClient();
    let query!: ReturnType<typeof createGraphqlEntityPropertiesQuery>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      query = createGraphqlEntityPropertiesQuery({
        entityType: () => 'INITIATIVE',
        entityId: () => 'initiative-1',
        enabled: () => true,
      });
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const data = {
      user: {
        soup: {
          items: [
            {
              __typename: 'GraphqlSoupInitiative',
              id: 'initiative-1',
              properties: [],
            },
          ],
        },
      },
    };
    requests[0].next({ data });
    await vi.waitFor(() => expect(query.result.data).toEqual([]));
    const property: SoupProperty = {
      id: 'assignment-1',
      definition: {
        id: 'definition-1',
        display_name: 'Status',
        data_type: 'STRING',
        is_multi_select: false,
        is_system: false,
        is_metadata: false,
        specific_entity_type: null,
        owner: { scope: 'system' },
        created_at: '',
        updated_at: '',
      },
      value: { type: 'String', value: 'In progress' },
    };
    mapGraphqlPropertiesMock.mockReturnValue([property]);
    const refresh = refetchGraphqlInitiativeProperties('initiative-1');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].operation.context.requestPolicy).toBe('network-only');
    requests[1].next({ data });
    await refresh;
    await vi.waitFor(() =>
      expect(query.result.data?.[0].value).toBe('In progress')
    );
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
